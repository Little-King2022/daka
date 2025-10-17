import './assets/main.css';
import 'tdesign-mobile-vue/es/style/index.css';
import { createApp } from 'vue';
import TDesign from 'tdesign-mobile-vue';
import App from './App.vue';
import i18n from './i18n';

const app = createApp(App);

app.use(TDesign);
app.use(i18n);

app.mount('#app');
