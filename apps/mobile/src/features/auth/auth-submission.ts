export function createSubmissionGuard() {
  let running = false;

  return {
    async run(work: () => Promise<void>) {
      if (running) return false;

      running = true;
      try {
        await work();
        return true;
      } finally {
        running = false;
      }
    },
  };
}
