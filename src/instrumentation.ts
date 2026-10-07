/** Runs once when the server starts. With DATA_SOURCE=mongo it loads (or seeds) MongoDB before serving requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DATA_SOURCE !== "mongo") return;
  const { initMongoStore } = await import("./server/persistence");
  try {
    await initMongoStore();
  } catch (e) {
    if (process.env.NODE_ENV === "production") throw e;
    console.error("[persistence] MongoDB is not reachable – falling back to the in-memory demo store.", (e as Error).message);
  }
}
