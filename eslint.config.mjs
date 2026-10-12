import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Dívida técnica conhecida (~165 usos): vira aviso para o CI não travar.
  // Meta: remover aos poucos nas telas/rotas que formos reescrevendo (Fase 5).
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // regra nova do react-hooks (15 telas com setState em effect): revisar no redesign
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
