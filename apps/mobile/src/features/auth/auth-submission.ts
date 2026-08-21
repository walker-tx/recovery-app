type SignInValues = Readonly<{
  email: string;
  password: string;
}>;

export function createSubmissionGuard() {
  let running = false;

  return {
    async run(
      values: SignInValues,
      work: (submittedValues: SignInValues) => Promise<void>,
    ) {
      if (running) return false;

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
