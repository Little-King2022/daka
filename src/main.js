import './assets/main.css';
import 'tdesign-mobile-vue/es/style/index.css';
import { createApp } from 'vue';
import TDesign from 'tdesign-mobile-vue';
import App from './App.vue';
import i18n from './i18n';
import { initSupabaseAuth } from './utils/supabase';

const app = createApp(App);

const bootstrap = async () => {
  try {
    await initSupabaseAuth();
  } catch (error) {
    console.error('初始化 Supabase 匿名会话失败:', error);
  }

  app.use(TDesign);
  app.use(i18n);

  app.mount('#app');
};

bootstrap();
