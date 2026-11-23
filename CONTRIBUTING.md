# Contribuindo

Obrigado pelo interesse em melhorar o projeto. Este guia resume como relatar problemas e enviar mudanças.

## Relatando problemas

Abra uma [issue](https://github.com/CaasiDantas/dynamic-island/issues/new/choose) usando o modelo adequado. Inclua a versão do app (em *Ajustes → Geral*), a versão do Windows e os passos para reproduzir o problema.

## Ambiente de desenvolvimento

```bash
npm install
npm run tauri dev
```

Para trabalhar só na interface, `npm run dev` abre o app no navegador. Acrescente `?demo=1` ao endereço para carregar dados de demonstração.

## Pull requests

1. Crie uma branch a partir de `main`.
2. Mantenha cada pull request focado em uma única mudança.
3. Antes de enviar, confira se o projeto compila:
   ```bash
   npx tsc --noEmit
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
4. Descreva o que mudou e como testar. Para mudanças visuais, anexe uma imagem ou um vídeo curto.

## Diretrizes

- **Desempenho.** A ilha precisa manter 60 fps. Anime apenas `transform` e `opacity` e não chame o núcleo em Rust a cada quadro.
- **Tema.** Use os tokens de cor do tema em vez de cores fixas, para que claro, escuro e cores personalizadas continuem funcionando.
- **Integrações nativas.** Código que usa APIs do Windows fica em Rust, numa thread própria, e envia eventos para a interface só quando algo muda.
- **Textos.** A interface é em português do Brasil, com frases curtas e diretas.

## Licença

Ao contribuir, você concorda que sua contribuição seja distribuída sob a [licença MIT](LICENSE).
