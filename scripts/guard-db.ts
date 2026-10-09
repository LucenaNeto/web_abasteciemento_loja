// scripts/guard-db.ts
// Trava de segurança: impede rodar migrate/seed contra o banco errado por engano.
// Exige APP_ENV explícito no arquivo .env.local (homolog | local | production).
// Produção só é liberada com ALLOW_PROD_DB=yes na linha de comando, de propósito.

export function assertSafeDb(action: string) {
  const env = (process.env.APP_ENV ?? "").trim().toLowerCase();

  if (!env) {
    throw new Error(
      `[guard-db] APP_ENV não definido. Abortando "${action}". ` +
        `Adicione APP_ENV=homolog (ou production) ao .env.local.`,
    );
  }

  if (env === "production" && process.env.ALLOW_PROD_DB !== "yes") {
    throw new Error(
      `[guard-db] APP_ENV=production. "${action}" bloqueado. ` +
        `Se for intencional (e aprovado), rode com ALLOW_PROD_DB=yes.`,
    );
  }

  console.log(`[guard-db] APP_ENV=${env} — liberado: ${action}`);
}
