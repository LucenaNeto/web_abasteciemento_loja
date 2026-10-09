// tests/setup.ts
// Os testes de integração escrevem no banco: só rodam contra HOMOLOGAÇÃO.
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

if ((process.env.APP_ENV ?? "").toLowerCase() !== "homolog") {
  throw new Error(
    "[tests] APP_ENV precisa ser 'homolog' (.env.local). Testes de integração nunca rodam em produção.",
  );
}

// Os testes de estoque exigem o controle de estoque ligado (em produção o padrão é desligado).
process.env.STOCK_CONTROL = "on";
