export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startIndexer } = await import("./lib/indexer");
    void startIndexer();
  }
}
