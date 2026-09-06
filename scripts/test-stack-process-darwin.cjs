const assert = require("node:assert/strict");
const { spawnSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const test = require("node:test");
test(
  "Darwin precise process evidence (system clang and macOS SDK)",
  { skip: process.platform !== "darwin" },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-darwin-"));
    let child;
    try {
      const source = path.join(__dirname, "stack-process-darwin.c");
      const compile = (input, output) => {
        const r = spawnSync(
          "/usr/bin/clang",
          ["-Wall", "-Wextra", "-Werror", input, "-o", output],
          { encoding: "utf8", timeout: 20000 },
        );
        assert.equal(r.status, 0, r.stderr);
      };
      const binary = path.join(dir, "inspect");
      compile(source, binary);
      const run = (exe, pid) =>
        spawnSync(exe, [String(pid)], { encoding: "utf8", timeout: 2000 });
      child = spawn(
        process.execPath,
        ["-e", 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'],
        { cwd: dir, stdio: ["ignore", "pipe", "ignore"] },
      );
      await once(child.stdout, "data");
      const first = run(binary, child.pid);
      assert.equal(first.status, 0, first.stderr);
      const evidence = JSON.parse(first.stdout);
      assert.deepEqual(Object.keys(evidence).sort(), [
        "pid",
        "startedAt",
        "worktree",
      ]);
      assert.equal(evidence.pid, child.pid);
      assert.match(evidence.startedAt, /^darwin:\d+:\d+$/);
      assert.equal(evidence.worktree, fs.realpathSync(dir));
      assert.deepEqual(JSON.parse(run(binary, child.pid).stdout), evidence);
      const exited = once(child, "exit");
      child.kill();
      await exited;
      assert.equal(run(binary, child.pid).stdout.trim(), "null");
      assert.notEqual(run(binary, "0").status, 0);
      assert.notEqual(run(binary, "123junk").status, 0);
      const fake = path.join(dir, "fake.c");
      fs.writeFileSync(
        fake,
        `
#include <libproc.h>
#include <sys/proc_info.h>
#include <signal.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
static int mode, reads;
static int fake_kill(pid_t p, int s) { (void)p; (void)s; errno = mode == 6 ? EPERM : ESRCH; return -1; }
static int fake_info(int pid, int flavor, uint64_t arg, void *buffer, int size) {
 (void)arg;
 if (mode == 1) { errno = EPERM; return 0; }
 if (mode == 2) return size - 1;
 if (mode == 5 || mode == 6) { errno = ESRCH; return 0; }
 if (mode == 7) { errno = EINVAL; return 0; }
 memset(buffer, 0, size);
 if (flavor == PROC_PIDTBSDINFO) {
   struct proc_bsdinfo *b = buffer; b->pbi_pid = pid; b->pbi_start_tvsec = 123; b->pbi_start_tvusec = (mode == 3 ? ++reads : 42);
 } else {
   struct proc_vnodepathinfo *v = buffer;
   if (mode == 4) memset(v->pvi_cdir.vip_path, 'a', sizeof(v->pvi_cdir.vip_path));
   else strcpy(v->pvi_cdir.vip_path, mode == 8 ? "/no-such-stack-test-directory" : "/tmp");
 }
 return size;
}
#define proc_pidinfo fake_info
#define kill fake_kill
#define main inspection_main
#include ${JSON.stringify(source)}
#undef main
int main(int argc, char **argv) { if (argc != 2) return 99; mode = atoi(argv[1]); char *args[] = {"inspect", "123", NULL}; return inspection_main(2, args); }
`,
      );
      const fakeBinary = path.join(dir, "fake");
      compile(fake, fakeBinary);
      assert.equal(run(fakeBinary, 0).status, 0);
      for (const mode of [1, 2, 3, 4, 6, 7, 8]) {
        const r = run(fakeBinary, mode);
        assert.notEqual(r.status, 0, `fault ${mode}`);
        assert.equal(r.stdout, "", `fault ${mode} must not publish evidence`);
      }
      assert.equal(run(fakeBinary, 5).stdout.trim(), "null");
    } finally {
      if (child && child.exitCode === null && child.signalCode === null)
        child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
