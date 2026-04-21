export function createManagedTaskController(runTask, {
  onFinally = null,
} = {}) {
  const state = {
    isRunning: false,
    isPaused: false,
    isStopping: false,
    pauseResolve: null,
  };

  const controller = {
    get isRunning() {
      return state.isRunning;
    },
    pause() {
      if (!state.isRunning) return;
      state.isPaused = true;
    },
    resume() {
      if (!state.isRunning) return;
      state.isPaused = false;
      if (state.pauseResolve) {
        state.pauseResolve();
        state.pauseResolve = null;
      }
    },
    stop() {
      if (!state.isRunning) return;
      state.isStopping = true;
      controller.resume();
    },
    shouldStop() {
      return state.isStopping;
    },
    async waitIfPaused() {
      if (!state.isPaused) return;
      await new Promise((resolve) => {
        state.pauseResolve = resolve;
      });
    },
    start() {
      if (state.isRunning) return;
      state.isRunning = true;
      state.isPaused = false;
      state.isStopping = false;
      Promise.resolve()
        .then(() => runTask({
          shouldStop: controller.shouldStop,
          waitIfPaused: controller.waitIfPaused,
        }))
        .finally(() => {
          state.isRunning = false;
          state.isPaused = false;
          state.isStopping = false;
          if (state.pauseResolve) {
            state.pauseResolve();
            state.pauseResolve = null;
          }
          onFinally?.();
        });
    },
  };

  return controller;
}
