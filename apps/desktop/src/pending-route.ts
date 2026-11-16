// A page asked for from outside the app (`omni open` as a second launch, an omni:// link) while the main window cannot
// show it: before the app is set up, or while the server starts, restarts (exit 75) or has failed. The next main
// window takes it, whoever opens it: the first start, Try Again on the failure screen, or a restart that comes back.

export interface RouteHost {
  /** The server is up, so the main window can load a page. */
  ready(): boolean;
  /** ctx.showMain: it calls take() with the route it was given. */
  showMain(route?: string): unknown;
}

export class PendingRoute {
  private held: string | null = null;
  private host: RouteHost | null = null;

  /** The app is set up: an ask from now on shows at once while the server is up. */
  attach(host: RouteHost): void {
    this.host = host;
  }

  /** Shows the page now if it can, else holds it. The latest ask wins. */
  ask(route: string): void {
    if (this.host?.ready()) this.host.showMain(route);
    else this.held = route;
  }

  /** The page the main window shows: the one it was given, else the held one. Either way nothing stays held. */
  take(given?: string): string | undefined {
    const route = given ?? this.held ?? undefined;
    this.held = null;
    return route;
  }

  /** The server is up again: a held page opens now. */
  serverReady(): void {
    if (this.held !== null && this.host) this.host.showMain();
  }
}
