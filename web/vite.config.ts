import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

// Em desenvolvimento (npm run dev), o Vite faz o mesmo papel do Nginx em produção:
//   /api/...           → API Gateway do LocalStack (stage "dev" da API "facegate")
//   /localstack/health → endpoint de saúde do LocalStack
const LOCALSTACK = 'http://localhost:4566'

// Mesma origem para o navegador: removemos o cabeçalho Origin ao repassar.
const semOrigin: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReq', (requisicao) => requisicao.removeHeader('origin'))
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: LOCALSTACK,
        rewrite: (caminho) => caminho.replace(/^\/api/, '/_aws/execute-api/facegate/dev'),
        configure: semOrigin,
      },
      '/localstack/health': {
        target: LOCALSTACK,
        rewrite: () => '/_localstack/health',
        configure: semOrigin,
      },
    },
  },
})
