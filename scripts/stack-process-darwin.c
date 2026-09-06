/* macOS only. Build with /usr/bin/clang (Xcode or Command Line Tools SDK).
 * API: helper <positive PID>; exit 0 emits JSON evidence or null (confirmed
 * absent); exit 1 emits no stdout. Never reads process argv/environment.
 * SDK: libproc.h proc_pidinfo; sys/proc_info.h PROC_PIDTBSDINFO and
 * PROC_PIDVNODEPATHINFO. No daemon ownership/stackId is inferred here.
 */
#include <libproc.h>
#include <sys/proc_info.h>
#include <signal.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int reject(void) {
    fputs("Cannot establish precise process identity\n", stderr);
    return 1;
}

int main(int argc, char **argv) {
    if (argc != 2 || !argv[1][0] || strspn(argv[1], "0123456789") != strlen(argv[1])) return reject();
    errno = 0;
    char *end;
    long number = strtol(argv[1], &end, 10);
    if (errno || *end || number < 1 || number > INT_MAX) return reject();
    int pid = (int)number;
    struct proc_bsdinfo before = {0}, after = {0};
    struct proc_vnodepathinfo paths = {0};
    errno = 0;
    int size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &before, sizeof(before));
    if (size != sizeof(before)) {
        /* Permission/unsupported/partial responses never mean absence. */
        if (size <= 0 && errno == ESRCH && kill(pid, 0) == -1 && errno == ESRCH) {
            puts("null");
            return 0;
        }
        return reject();
    }
    if (before.pbi_pid != (uint32_t)pid || !before.pbi_start_tvsec || before.pbi_start_tvusec >= 1000000) return reject();
    if (proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &paths, sizeof(paths)) != sizeof(paths)) return reject();
    const char *cwd = paths.pvi_cdir.vip_path;
    size_t length = strnlen(cwd, sizeof(paths.pvi_cdir.vip_path));
    if (length == 0 || length >= sizeof(paths.pvi_cdir.vip_path) - 1 || cwd[0] != '/') return reject();
    char canonical[PATH_MAX];
    if (!realpath(cwd, canonical)) return reject();
    /* Reject non-ASCII rather than silently corrupt arbitrary filesystem bytes
     * when serializing JSON. This is an explicit conservative portability limit. */
    for (const unsigned char *p = (const unsigned char *)canonical; *p; p++) {
        if (*p >= 128) return reject();
    }
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) != sizeof(after) ||
        before.pbi_pid != after.pbi_pid || before.pbi_start_tvsec != after.pbi_start_tvsec ||
        before.pbi_start_tvusec != after.pbi_start_tvusec) return reject();
    printf("{\"pid\":%d,\"startedAt\":\"darwin:%llu:%llu\",\"worktree\":\"", pid,
           (unsigned long long)before.pbi_start_tvsec, (unsigned long long)before.pbi_start_tvusec);
    for (const unsigned char *p = (const unsigned char *)canonical; *p; p++) {
        if (*p == '"' || *p == '\\') printf("\\%c", *p);
        else if (*p < 32) printf("\\u%04x", *p);
        else putchar(*p);
    }
    puts("\"}");
    return 0;
}
