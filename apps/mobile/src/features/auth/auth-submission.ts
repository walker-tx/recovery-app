export function createSubmissionGuard() {
  let running = false;

  return {
    async run<Values>(
      values: Values,
      work: (submittedValues: Values) => Promise<void>,
    ) {
      if (running) {
        return false;
      }

      running = true;
      try {
        await work(values);
        return true;
      } finally {
        running = false;
      }
    },
  };
}
