import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const secProxyOptions = {
  target: 'https://www.sec.gov',
  changeOrigin: true,
  headers: {
    'User-Agent': 'Intellicomply Research App contact@intellicomply.example.com'
  },
  configure: (proxy: any, _options: any) => {
    proxy.on('proxyRes', (proxyRes: any) => {
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      
      // Rewrite redirects to ensure they stay on the local dev server
      if (proxyRes.headers['location']) {
         let loc = proxyRes.headers['location'];
         if (loc.startsWith('https://www.sec.gov')) {
           proxyRes.headers['location'] = loc.replace('https://www.sec.gov', '');
         }
      }
    });
  }
};

const secDataProxyOptions = {
  target: 'https://data.sec.gov',
  changeOrigin: true,
  headers: {
    'User-Agent': 'Intellicomply Research App contact@intellicomply.example.com'
  },
  configure: (proxy: any, _options: any) => {
    proxy.on('proxyRes', (proxyRes: any) => {
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
    });
  }
};

const eftsProxyOptions = {
  target: 'https://efts.sec.gov',
  changeOrigin: true,
  headers: {
    'User-Agent': 'Intellicomply Research App contact@intellicomply.example.com'
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/sec-proxy': {
        ...secProxyOptions,
        rewrite: (path) => path.replace(/^\/sec-proxy/, '')
      },
      // Proxy for data.sec.gov (XBRL companyfacts + submissions)
      '/sec-data': {
        ...secDataProxyOptions,
        rewrite: (path) => path.replace(/^\/sec-data/, '')
      },
      // Proxy for efts.sec.gov (full-text search)
      '/sec-efts': {
        ...eftsProxyOptions,
        rewrite: (path) => path.replace(/^\/sec-efts/, '')
      },
      '/ix': secProxyOptions,
      '/ixviewer': secProxyOptions,
      '/Archives': secProxyOptions,
      '/include': secProxyOptions,
      '/files': secProxyOptions,
      '/assets': secProxyOptions,
      '/cdata': secProxyOptions,
      '/js': secProxyOptions,
      '/css': secProxyOptions,
      '/images': secProxyOptions
    }
  }
})

