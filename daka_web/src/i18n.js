import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en.json';

const SUPPORTED_LOCALES = ['zh-CN', 'en'];

const detectLocale = () => {
  const navigatorLocale = (navigator.languages && navigator.languages.length)
    ? navigator.languages[0]
    : navigator.language;

  if (!navigatorLocale) {
    return 'en';
  }

  const locale = navigatorLocale.toLowerCase();

  if (locale.includes('zh')) {
    return 'zh-CN';
  }

  return 'en';
};

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: {
    'zh-CN': zhCN,
    en: enUS,
  },
  availableLocales: SUPPORTED_LOCALES,
});

export default i18n;
