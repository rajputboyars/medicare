/**
 * Runs once when the server starts.
 *  - With DATA_SOURCE=mongo it loads (or seeds) MongoDB before serving requests.
 *  - It starts a small housekeeping timer: unpaid online orders give their stock back, and old searches close themselves.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.DATA_SOURCE === "mongo") {
    const { initMongoStore } = await import("./server/persistence");
    try {
      await initMongoStore();
    } catch (e) {
      if (process.env.NODE_ENV === "production") throw e;
      console.error("[persistence] MongoDB is not reachable or its data is outdated – falling back to the in-memory demo store.", (e as Error).message);
    }
  }

  const g = globalThis as unknown as { __mcSweeper?: ReturnType<typeof setInterval> };
  if (g.__mcSweeper) return;
  const { expireReservations } = await import("./server/features/orders/orders.service");
  const { expireStaleRequests } = await import("./server/features/medicine-requests/requests.service");
  const { flush, persistenceActive } = await import("./server/persistence");
  const { purgeOtpChallenges } = await import("./server/features/auth/otp.service");
  const { purgeSessions } = await import("./server/features/auth/session.service");
  g.__mcSweeper = setInterval(() => {
    try {
      const changed = expireReservations() + expireStaleRequests() + purgeOtpChallenges() + purgeSessions();
      if (changed && persistenceActive()) void flush();
    } catch (e) {
      console.error("[sweeper] failed", e);
    }
  }, 60_000);
  g.__mcSweeper.unref?.();
}
