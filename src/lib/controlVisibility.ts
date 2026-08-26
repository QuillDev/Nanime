export interface VisibilityTimer {
  readonly cancel: () => void;
}

export interface VisibilityScheduler {
  readonly schedule: (task: () => void, delay: number) => VisibilityTimer;
}

const browserScheduler: VisibilityScheduler = {
  schedule: (task, delay) => {
    const timer = setTimeout(task, delay);
    return { cancel: () => clearTimeout(timer) };
  },
};

export class ControlVisibilityController {
  private readonly setVisible: (visible: boolean) => void;
  private readonly scheduler: VisibilityScheduler;
  private readonly delay: number;
  private timer: VisibilityTimer | null = null;
  private interactionHeld = false;

  constructor(
    setVisible: (visible: boolean) => void,
    scheduler: VisibilityScheduler = browserScheduler,
    delay = 2500,
  ) {
    this.setVisible = setVisible;
    this.scheduler = scheduler;
    this.delay = delay;
  }

  activity(): void {
    this.clearTimer();
    this.setVisible(true);
    if (!this.interactionHeld) {
      this.timer = this.scheduler.schedule(() => {
        this.timer = null;
        this.setVisible(false);
      }, this.delay);
    }
  }

  interactionStart(): void {
    this.interactionHeld = true;
    this.activity();
  }

  interactionEnd(): void {
    this.interactionHeld = false;
    this.activity();
  }

  hide(): void {
    this.clearTimer();
    this.setVisible(false);
  }

  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timer.cancel();
      this.timer = null;
    }
  }
}
