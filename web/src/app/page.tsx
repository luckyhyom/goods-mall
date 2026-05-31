type Health = { status: string; db?: string };

async function getHealth(): Promise<Health> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, {
      cache: "no-store",
    });
    if (!res.ok) return { status: "error" };
    return (await res.json()) as Health;
  } catch {
    return { status: "unreachable" };
  }
}

export default async function Home() {
  const health = await getHealth();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <h1 className="text-3xl font-bold">goods-mall</h1>
      <p className="text-sm text-gray-500">
        API: <span className="font-mono">{health.status}</span>
        {health.db ? ` · DB: ${health.db}` : ""}
      </p>
    </main>
  );
}
