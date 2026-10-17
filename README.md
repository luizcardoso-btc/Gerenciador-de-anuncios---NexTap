# ✈️ AdPilot — gerenciador de anúncios da sua conta Meta

Lê os números dos seus anúncios (Facebook/Instagram), compara com as **suas metas** e **sugere** o que fazer: pausar o que gasta sem resultar, reduzir verba do que está caro, aumentar gradualmente o que está barato, avisar de público saturado e criativo cansado. **Nada muda na Meta sem você clicar em Aprovar**, e toda ação pode ser desfeita.

Mede dois objetivos separados: **conversas iniciadas** (Instagram/WhatsApp) e **resultados no site** (compra/lead, com retorno).

## Colocar no ar (Railway)
1. Crie um repositório novo no GitHub (ex.: `AdPilot`) e suba todos os arquivos desta pasta.
2. Railway → New Project → Deploy from GitHub → escolha o repositório.
3. Adicione um **Volume** (ex.: montado em `/data`) e a variável `DATA_DIR=/data` para o banco não se perder.
4. Variáveis: `ADMIN_PASSWORD` (sua senha), `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` (formato `act_123456789`).

## Pegar o token da Meta (uma vez)
1. developers.facebook.com → **Meus apps → Criar app** (tipo "Negócios"), adicione o produto **API de Marketing**.
2. business.facebook.com → **Configurações do negócio → Usuários → Usuários do sistema** → criar um usuário do sistema (Admin).
3. Atribua a ele a **conta de anúncios** (controle total) e o app.
4. **Gerar token** com as permissões `ads_management` e `ads_read`. Esse é o `META_ACCESS_TOKEN`.
5. O ID da conta está no Gerenciador de Anúncios (`act_...`).
Para gerenciar a **sua própria** conta, o app em modo de desenvolvimento costuma bastar; se a Meta pedir revisão do app, é só para contas de terceiros.

## Como decide (tudo ajustável na aba Metas)
- **Pausar**: gastou ≥ 2× a meta sem nenhum resultado; ou custo > 1,6× a meta; ou retorno do site abaixo do mínimo.
- **Reduzir 30% da verba**: custo entre 1,3× e 1,6× a meta.
- **Aumentar +20%**: custo ≤ 0,8× a meta com ≥ 5 resultados (respeita os tetos que você definir).
- **Avisos**: frequência alta (público saturado) e queda de CTR (criativo cansando).
- **Pausar anúncio fraco** dentro de um conjunto que funciona.
- Não mexe em conjunto criado há menos de 72 h, nem muda a verba duas vezes seguidas (evita reiniciar o aprendizado). Aumento nunca passa do passo máximo.

## Criar anúncios e rodar um teste A/B
1. **🖼 Criativos**: suba as fotos (PNG/JPG até 8 MB).
2. **🧪 Testes → Novo teste**: nome, objetivo (conversas no Instagram Direct ou visitas ao site), verba diária total, duração, região (sua localização + raio) e idade. Preencha produto, público e benefício e clique **Gerar textos**: saem 2 a 6 variações com ângulos diferentes (dor, benefício, oferta, curiosidade, prova social, simples). Edite o que quiser e escolha uma imagem para cada.
3. **Criar na Meta (pausado)**: monta campanha, um conjunto por variação (verba dividida igual, mesmo público), criativo e anúncio. **Nada gasta ainda.** Se algo falhar no meio, ele apaga o que criou.
4. **Publicar**: pede confirmação mostrando o gasto máximo e liga tudo.
5. A cada atualização, o AdPilot compara as variações. Quando há dados suficientes (ou o prazo acaba) ele declara **vencedor**, **empate** ou **sem dados** e cria sugestões: pausar as perdedoras e aumentar a vencedora. Você aprova na aba Sugestões.
Durante o teste as regras automáticas não mexem nesses conjuntos, para o teste ser justo.

Variáveis extras: `META_PAGE_ID` (Página do Facebook ligada ao Instagram), `META_INSTAGRAM_ID` (ID da conta do Instagram para anúncios). `ANTHROPIC_API_KEY` é opcional: com ela os textos são escritos por IA; sem ela, usa modelos prontos (grátis).

## Limites desta versão
Cria testes com imagem + texto (não gera imagens nem vídeos). Analisa, sugere e aplica pausar/ativar e ajuste de verba **por conjunto**. Não mexe em verba definida no nível da campanha (CBO): nesse caso avisa para ajustar no Gerenciador.
