# Central Analítica STI

Painel independente do STI OS para gestores. Consulta somente indicadores consolidados por meio da função segura `sti_dashboard_metrics` do Supabase.

Para ativar os filtros combinados de escola e analista, execute uma vez o arquivo `supabase/004_dashboard_filters.sql` no SQL Editor do Supabase. O script cria uma nova função de leitura e não altera os registros do STI OS.

## GitHub Pages

O fluxo em `.github/workflows/deploy-pages.yml` publica automaticamente a branch `main`. No repositório, selecione **Settings → Pages → Source → GitHub Actions**.

No Supabase, adicione a URL final do GitHub Pages em **Authentication → URL Configuration → Redirect URLs**.
