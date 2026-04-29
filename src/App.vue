<script setup>
import { ref, computed, onBeforeUnmount, watch } from 'vue';
import { Toast, Dialog } from 'tdesign-mobile-vue';
import axios from 'axios';
import md5 from './utils/md5';
import { getDakaSettings, recordUserInfo, saveDakaSettings } from './utils/supabase';
import { useI18n } from 'vue-i18n';
import instructionImg from './assets/instruction.png';

const { t, locale } = useI18n();

const API_BASE = 'https://api.hikiot.com';
const SMS_API_BASE = 'https://hiklogin.littleking.site/api';
const FIXED_SIGN_SALT = 'WE1mfER7artAoJEwXKaCjw==';
const REST_KEYWORD = '休息';
const CUSTOM_CONFIG_KEY = 'daka_config_custom';
const THEME_KEY = 'daka_theme';
const DEFAULT_DAKA_CONFIG = {
  message: 'success',
  location: '江苏省南京市浦口区江浦街道南京农业大学滨江校区农学院南京农业大学(滨江校区)',
  address: '江苏省南京市浦口区江浦街道南京农业大学滨江校区农学院南京农业大学(滨江校区)',
  longitude: 118.636838,
  latitude: 32.011898,
  wifi: 'NJAU',
  device_name: '微信小程序',
  wifi_mac: '58:ae:a8:32:59:90',
  randomOffset: 50,
};

/* ── Theme ── */
const prefersDarkMq = window.matchMedia('(prefers-color-scheme: dark)');
const savedTheme = localStorage.getItem(THEME_KEY);
const isDark = ref(savedTheme ? savedTheme === 'dark' : prefersDarkMq.matches);
const followSystem = ref(!savedTheme);

const handleSystemThemeChange = (e) => {
  if (followSystem.value) isDark.value = e.matches;
};
prefersDarkMq.addEventListener('change', handleSystemThemeChange);

watch(isDark, (v) => {
  document.documentElement.setAttribute('data-theme', v ? 'dark' : 'light');
}, { immediate: true });

const toggleDark = () => {
  isDark.value = !isDark.value;
  followSystem.value = false;
  localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light');
};

/* ── App state ── */
const overlay_visible = ref(false);
const token = ref('');
const auto_login = ref(false);
const has_verified = ref(false);
const has_tested = ref(false);
const account_info = ref({ is_rest_rule: false });
const today_status = ref({});
const daka_config = ref(null);
const errorMessage = ref('');
const isCheckingIn = ref(false);
const cooldownRemaining = ref(0);
let cooldownTimer = null;

const showSuccess = ref(false);
const showEditDialog = ref(false);
const editForm = ref({});
const editErrors = ref({});

const loginMethod = ref('sms');
const phone = ref('');
const smsCode = ref('');
const smsCooldown = ref(0);
let smsCooldownTimer = null;
const isSendingCode = ref(false);
const isSmsLoggingIn = ref(false);

const imgZoom = ref(false);
const collapseUser = ref(true);
const collapseLocation = ref(true);
const collapseTutorial = ref(true);
const collapseSchedule = ref(true);

/* ── Smart Schedule ── */
const SCHEDULE_KEY = 'daka_schedule_config';
const SCHEDULE_LOG_KEY = 'daka_schedule_log';
const SCHEDULE_PLAN_KEY = 'daka_schedule_plan';
const SCHEDULE_RUN_STATE_KEY = 'daka_schedule_run_state';
const SCHEDULE_RUN_WINDOW_MINUTES = 10;
const DEFAULT_SCHEDULE = {
  enabled: false,
  morning: { hour: 8, minute: 30, variance: 15 },   // 8:30 ±15min
  evening: { hour: 17, minute: 30, variance: 20 },   // 17:30 ±20min
  retryMaxAttempts: 3,
  retryBaseDelay: 5000,  // 5s base, exponential backoff
};

const scheduleConfig = ref({ ...DEFAULT_SCHEDULE });
const scheduleLog = ref([]);
const nextScheduleTime = ref(null);
const isScheduleTriggered = ref(false);
const scheduleStatusText = ref('');
const scheduleRunState = ref({ date: '', runs: {} });
const showScheduleGuide = ref(false);
const deferredInstallPrompt = ref(null);
const scheduleGuideChecks = ref({
  autoStart: false,
  performanceWhitelist: false,
});
let isApplyingRemoteSettings = false;

const APP_DOMAIN = 'daka.littleking.site';
const EDGE_PERFORMANCE_SETTINGS_URL = 'edge://settings/system/managePerformance';
const CHROME_PERFORMANCE_SETTINGS_URL = 'chrome://settings/performance';

const displayModeStandaloneMq = window.matchMedia('(display-mode: standalone)');
const isStandalonePwa = ref(displayModeStandaloneMq.matches || window.navigator.standalone === true);
const isDesktopDevice = ref(!(
  window.navigator.userAgentData?.mobile ||
  /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(window.navigator.userAgent || '') ||
  (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
));

const canUseAutoSchedule = computed(() => isDesktopDevice.value && isStandalonePwa.value);
const scheduleRuntimeEnabled = computed(() => scheduleConfig.value.enabled && canUseAutoSchedule.value);
const scheduleBadgeText = computed(() => {
  if (!scheduleConfig.value.enabled) return t('schedule.off');
  return canUseAutoSchedule.value ? t('schedule.on') : t('schedule.unavailable');
});
const detectedBrowser = computed(() => {
  const ua = window.navigator.userAgent || '';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Chrome/')) return 'chrome';
  return 'other';
});
const performanceSettingsUrl = computed(() =>
  detectedBrowser.value === 'chrome' ? CHROME_PERFORMANCE_SETTINGS_URL : EDGE_PERFORMANCE_SETTINGS_URL,
);
const canFinishScheduleGuide = computed(() =>
  canUseAutoSchedule.value &&
  scheduleGuideChecks.value.autoStart &&
  scheduleGuideChecks.value.performanceWhitelist,
);

const handleDisplayModeChange = (event) => {
  isStandalonePwa.value = event.matches || window.navigator.standalone === true;
};
if (displayModeStandaloneMq.addEventListener) {
  displayModeStandaloneMq.addEventListener('change', handleDisplayModeChange);
} else if (displayModeStandaloneMq.addListener) {
  displayModeStandaloneMq.addListener(handleDisplayModeChange);
}

const handleBeforeInstallPrompt = (event) => {
  event.preventDefault();
  deferredInstallPrompt.value = event;
};
window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

const openScheduleGuide = () => {
  showScheduleGuide.value = true;
};

const closeScheduleGuide = () => {
  showScheduleGuide.value = false;
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    Toast(t('schedule.guide.copied'));
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    Toast(t('schedule.guide.copied'));
  }
};

const installPwa = async () => {
  if (!deferredInstallPrompt.value) {
    Toast(t('schedule.guide.installUnavailable'));
    return;
  }
  deferredInstallPrompt.value.prompt();
  await deferredInstallPrompt.value.userChoice;
  deferredInstallPrompt.value = null;
};

const openPerformanceSettings = () => {
  copyText(performanceSettingsUrl.value);
};

const finishScheduleGuide = () => {
  if (!canUseAutoSchedule.value) {
    Toast(t('schedule.desktopPwaOnly'));
    return;
  }
  if (!canFinishScheduleGuide.value) {
    Toast(t('schedule.guide.completeChecklist'));
    return;
  }
  showScheduleGuide.value = false;
  if (!scheduleConfig.value.enabled) {
    scheduleConfig.value.enabled = true;
    saveScheduleConfig();
  }
  startScheduleTimer();
};

const getDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getScheduleSignature = () => {
  const cfg = scheduleConfig.value;
  return JSON.stringify({
    morning: cfg.morning,
    evening: cfg.evening,
  });
};

const normalizeScheduleConfig = (config = {}) => ({
  ...DEFAULT_SCHEDULE,
  ...config,
  morning: { ...DEFAULT_SCHEDULE.morning, ...(config.morning ?? {}) },
  evening: { ...DEFAULT_SCHEDULE.evening, ...(config.evening ?? {}) },
});

const timeToMinutes = (time) => time.hour * 60 + time.minute;

const formatScheduleTime = (time) =>
  `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;

const ensureTodayRunState = () => {
  const today = getDateKey();
  if (scheduleRunState.value.date !== today) {
    scheduleRunState.value = { date: today, runs: {} };
    localStorage.setItem(SCHEDULE_RUN_STATE_KEY, JSON.stringify(scheduleRunState.value));
  }
};

const loadScheduleRunState = () => {
  const saved = localStorage.getItem(SCHEDULE_RUN_STATE_KEY);
  if (saved) {
    try {
      scheduleRunState.value = JSON.parse(saved);
    } catch (e) {
      scheduleRunState.value = { date: '', runs: {} };
    }
  }
  ensureTodayRunState();
};

const hasScheduleRun = (shift) => {
  ensureTodayRunState();
  return !!scheduleRunState.value.runs?.[shift];
};

const markScheduleRun = (shift, status, message = '') => {
  ensureTodayRunState();
  scheduleRunState.value = {
    ...scheduleRunState.value,
    runs: {
      ...scheduleRunState.value.runs,
      [shift]: {
        status,
        message,
        time: new Date().toISOString(),
      },
    },
  };
  localStorage.setItem(SCHEDULE_RUN_STATE_KEY, JSON.stringify(scheduleRunState.value));
};

const loadScheduleConfig = () => {
  const saved = localStorage.getItem(SCHEDULE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      scheduleConfig.value = normalizeScheduleConfig(parsed);
    } catch (e) { /* ignore */ }
  }
};

const saveScheduleConfig = () => {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(scheduleConfig.value));
  if (scheduleRuntimeEnabled.value) {
    computeTodaySchedule(true);
    findNextSchedule();
  } else {
    stopScheduleTimer();
  }
  if (!isApplyingRemoteSettings) {
    syncDakaSettingsToSupabase().catch(() => {});
  }
};

const loadScheduleLog = () => {
  const saved = localStorage.getItem(SCHEDULE_LOG_KEY);
  if (saved) {
    try {
      scheduleLog.value = JSON.parse(saved);
    } catch (e) { scheduleLog.value = []; }
  }
};

const addScheduleLog = (entry) => {
  const log = { ...entry, time: new Date().toISOString() };
  scheduleLog.value.unshift(log);
  // Keep last 50 entries
  if (scheduleLog.value.length > 50) scheduleLog.value = scheduleLog.value.slice(0, 50);
  localStorage.setItem(SCHEDULE_LOG_KEY, JSON.stringify(scheduleLog.value));
};

const getScheduleLogTypeLabel = (type) => {
  const labels = {
    triggered: t('schedule.logTypes.triggered'),
    success: t('schedule.logTypes.success'),
    retry: t('schedule.logTypes.retry'),
    failed: t('schedule.logTypes.failed'),
    skipped: t('schedule.logTypes.skipped'),
  };
  return labels[type] ?? type;
};

const getScheduleShiftLabel = (shift) => {
  const labels = {
    morning: t('schedule.logShifts.morning'),
    evening: t('schedule.logShifts.evening'),
    manual: t('schedule.logShifts.manual'),
  };
  return labels[shift] ?? shift;
};

const getScheduleLogMessage = (log) => {
  if (log.messageKey) {
    return t(`schedule.logMessages.${log.messageKey}`, log.messageParams ?? {});
  }
  return log.message ?? '';
};

const getScheduleLogSummary = (log) => {
  const attemptText = log.attempt
    ? t('schedule.logAttempt', { n: log.attempt })
    : log.attempts
      ? t('schedule.logAttempts', { n: log.attempts })
      : '';
  return [
    getScheduleShiftLabel(log.shift),
    attemptText,
    getScheduleLogMessage(log),
  ].filter(Boolean).join(' · ');
};

const formatScheduleLogTime = (time) => {
  const timeLocale = locale.value === 'en' ? 'en-US' : 'zh-CN';
  return new Date(time).toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' });
};

// Generate random time with variance (minutes)
const generateRandomTime = (baseHour, baseMinute, varianceMinutes) => {
  const offsetMinutes = Math.floor(Math.random() * (2 * varianceMinutes + 1)) - varianceMinutes;
  const totalMinutes = baseHour * 60 + baseMinute + offsetMinutes;
  const clamped = Math.max(0, Math.min(24 * 60 - 1, totalMinutes));
  return { hour: Math.floor(clamped / 60), minute: clamped % 60 };
};

const todayScheduledTimes = ref({ morning: null, evening: null });

// Compute today's scheduled times once per date and config.
const computeTodaySchedule = (force = false) => {
  const today = getDateKey();
  const signature = getScheduleSignature();
  if (!force) {
    const saved = localStorage.getItem(SCHEDULE_PLAN_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.date === today && parsed?.signature === signature && parsed?.times) {
          todayScheduledTimes.value = parsed.times;
          return;
        }
      } catch (e) { /* ignore */ }
    }
  }

  const cfg = scheduleConfig.value;
  const times = {
    morning: generateRandomTime(cfg.morning.hour, cfg.morning.minute, cfg.morning.variance),
    evening: generateRandomTime(cfg.evening.hour, cfg.evening.minute, cfg.evening.variance),
  };
  todayScheduledTimes.value = times;
  localStorage.setItem(SCHEDULE_PLAN_KEY, JSON.stringify({ date: today, signature, times }));
};

// Find the next upcoming scheduled time for today
const findNextSchedule = () => {
  if (!scheduleRuntimeEnabled.value) {
    nextScheduleTime.value = null;
    scheduleStatusText.value = '';
    return;
  }
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const times = todayScheduledTimes.value;

  ensureTodayRunState();
  const candidates = [];
  if (times.morning) {
    candidates.push({ ...times.morning, label: 'morning' });
  }
  if (times.evening) {
    candidates.push({ ...times.evening, label: 'evening' });
  }

  for (const t of candidates.sort((a, b) => timeToMinutes(a) - timeToMinutes(b))) {
    const tMinutes = timeToMinutes(t);
    const isUpcomingOrRecoverable = tMinutes > nowMinutes || nowMinutes - tMinutes <= SCHEDULE_RUN_WINDOW_MINUTES;
    if (isUpcomingOrRecoverable && !hasScheduleRun(t.label)) {
      nextScheduleTime.value = t;
      scheduleStatusText.value = formatScheduleTime(t);
      return;
    }
  }
  // All past for today
  nextScheduleTime.value = null;
  scheduleStatusText.value = t('schedule.tomorrow');
};

// Check if already checked in for a given shift
const isAlreadyCheckedIn = (shift) => {
  const details = [
    ...(today_status.value?.current?.details ?? []),
    ...(today_status.value?.others ?? []).flatMap(item => item?.details ?? []),
  ];
  if (!details || !details.length) return false;

  return details.some(d => {
    const desc = d.statusDesc || '';
    const label = `${d.desc ?? ''} ${d.name ?? ''} ${d.clockName ?? ''}`;
    const isDone = desc.includes('\u5df2\u6253\u5361') || desc.includes('\u6b63\u5e38');
    if (!isDone) return false;
    if (shift === 'morning') return label.includes('\u4e0a\u73ed') || label.includes('\u7b7e\u5230');
    if (shift === 'evening') return label.includes('\u4e0b\u73ed') || label.includes('\u7b7e\u9000');
    return isDone;
  });
};

// ── Retry with exponential backoff ──
const dakaWithRetry = async (maxAttempts = 3, baseDelay = 5000, shift = 'manual') => {
  let lastError = null;
  let lastErrorKey = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await daka(true); // silent mode
      if (result) {
        addScheduleLog({ type: 'success', shift, attempt, messageKey: 'checkInSuccess' });
        return true;
      }
      lastError = '';
      lastErrorKey = 'apiFailure';
    } catch (error) {
      lastError = error.message || String(error);
      lastErrorKey = null;
    }
    addScheduleLog({ type: 'retry', shift, attempt, message: lastError, messageKey: lastErrorKey });
    if (attempt < maxAttempts) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  addScheduleLog({ type: 'failed', shift, attempts: maxAttempts, message: lastError, messageKey: lastErrorKey });
  return false;
};

// ── Schedule timer ──
let scheduleTimer = null;
const SCHEDULE_CHECK_INTERVAL = 30 * 1000; // Check every 30s

const checkScheduleAndRun = async () => {
  if (!scheduleRuntimeEnabled.value || !has_tested.value || isCheckingIn.value || isScheduleTriggered.value) return;
  ensureTodayRunState();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const times = todayScheduledTimes.value;

  const dueItems = Object.entries(times)
    .filter(([, scheduledTime]) => !!scheduledTime)
    .map(([shift, scheduledTime]) => ({
      shift,
      scheduledTime,
      minutes: timeToMinutes(scheduledTime),
    }))
    .filter(({ shift, minutes }) => {
      const minutesLate = nowMinutes - minutes;
      return minutesLate >= 0 && minutesLate <= SCHEDULE_RUN_WINDOW_MINUTES && !hasScheduleRun(shift);
    })
    .sort((a, b) => a.minutes - b.minutes);

  for (const { shift, scheduledTime } of dueItems) {
    isScheduleTriggered.value = true;
    try {
      await get_today_status(true);
      if (isAlreadyCheckedIn(shift)) {
        markScheduleRun(shift, 'skipped', 'already checked in');
        addScheduleLog({ type: 'skipped', shift, messageKey: 'alreadyCheckedIn' });
        findNextSchedule();
        continue;
      }

      addScheduleLog({
        type: 'triggered',
        shift,
        messageKey: 'autoTrigger',
        messageParams: { time: formatScheduleTime(scheduledTime) },
      });
      const cfg = scheduleConfig.value;
      const success = await dakaWithRetry(cfg.retryMaxAttempts, cfg.retryBaseDelay, shift);
      markScheduleRun(shift, success ? 'success' : 'failed');
      findNextSchedule();
    } finally {
      isScheduleTriggered.value = false;
    }
    break;
  }
};

const startScheduleTimer = () => {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  if (!scheduleRuntimeEnabled.value) return;
  computeTodaySchedule();
  ensureTodayRunState();
  findNextSchedule();
  checkScheduleAndRun();
  scheduleTimer = setInterval(checkScheduleAndRun, SCHEDULE_CHECK_INTERVAL);
};

const stopScheduleTimer = () => {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  nextScheduleTime.value = null;
  scheduleStatusText.value = '';
};

const toggleSchedule = () => {
  if (!scheduleConfig.value.enabled && !canUseAutoSchedule.value) {
    openScheduleGuide();
    return;
  }
  scheduleConfig.value.enabled = !scheduleConfig.value.enabled;
  saveScheduleConfig();
  if (scheduleRuntimeEnabled.value) {
    startScheduleTimer();
  } else {
    stopScheduleTimer();
  }
};

/* ── Live clock ── */
const now = ref(new Date());
const clockTimer = setInterval(() => { now.value = new Date(); }, 1000);

const timeStr = computed(() =>
  now.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
);
const dateStr = computed(() =>
  now.value.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }),
);

const clearCooldown = () => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
};

const startCooldown = (seconds) => {
  clearCooldown();
  cooldownRemaining.value = seconds;
  cooldownTimer = setInterval(() => {
    if (cooldownRemaining.value <= 1) {
      cooldownRemaining.value = 0;
      clearCooldown();
    } else {
      cooldownRemaining.value -= 1;
    }
  }, 1000);
};

onBeforeUnmount(() => {
  clearCooldown();
  stopScheduleTimer();
  if (midnightCheck) clearInterval(midnightCheck);
  if (smsCooldownTimer) clearInterval(smsCooldownTimer);
  if (clockTimer) clearInterval(clockTimer);
  prefersDarkMq.removeEventListener('change', handleSystemThemeChange);
  if (displayModeStandaloneMq.removeEventListener) {
    displayModeStandaloneMq.removeEventListener('change', handleDisplayModeChange);
  } else if (displayModeStandaloneMq.removeListener) {
    displayModeStandaloneMq.removeListener(handleDisplayModeChange);
  }
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
});

const isTimeRestricted = computed(() => {
  if (import.meta.env.VITE_ENABLE_TIME_RESTRICTION !== 'true') return false;
  const d = now.value;
  const totalMinutes = d.getHours() * 60 + d.getMinutes();
  return totalMinutes >= 2 * 60 && totalMinutes < 8 * 60 + 30;
});

const checkInButtonText = computed(() => {
  if (cooldownRemaining.value > 0) return `${cooldownRemaining.value}s`;
  return t('buttons.primaryCheckIn');
});

const greetingName = computed(() =>
  account_info.value?.name || account_info.value?.nick_name || '',
);

const greeting = computed(() => {
  const h = now.value.getHours();
  if (h < 6) return t('greetings.dawn');
  if (h < 9) return t('greetings.morning');
  if (h < 11) return t('greetings.forenoon');
  if (h < 13) return t('greetings.noon');
  if (h < 18) return t('greetings.afternoon');
  if (h < 23) return t('greetings.evening');
  return t('greetings.lateNight');
});

/* ── API ── */
const getHeaders = (authToken) => ({
  'Authorization': `Bearer ${authToken}`,
  'terminal': '0',
  'UNI-Request-Source': '4',
  'Pragma': 'no-cache',
  'content-type': 'application/json',
});

const getMonthQuery = () => {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}`;
};

const fetchWithHeaders = async (url, authToken) => {
  try {
    const response = await axios.get(url, { headers: getHeaders(authToken) });
    return response.data;
  } catch (error) {
    console.error('请求失败:', error);
    return null;
  }
};

const getAccountInfo = async (authToken) => {
  try {
    const [response1, response2, response3] = await Promise.all([
      fetchWithHeaders(`${API_BASE}/api-saas/v1/account/detail`, authToken),
      fetchWithHeaders(
        `${API_BASE}/api-attendance/v1/statistics/individual/daily?month=${getMonthQuery()}&personNo=&ID=myStatic`,
        authToken,
      ),
      fetchWithHeaders(`${API_BASE}/api-attendance/mobile-clock/v1/individual-clock-rules`, authToken),
    ]);

    if (response1?.code !== 0 || response2?.code !== 0 || response3?.code !== 0) return null;
    if (!response1?.data || !response2?.data || !response3?.data) return null;

    const ruleText = response3.data?.shiftDetail ?? '';
    const hasRule = !!ruleText;
    const isRestRule = typeof ruleText === 'string' && ruleText.includes(REST_KEYWORD);

    let rule = hasRule ? ruleText : t('account.ruleUnset');
    if (isRestRule) rule = t('messages.ruleRestLabel');

    return {
      account_no: response1.data?.accountNo ?? '',
      nick_name: response1.data?.nickName ?? t('account.nicknameUnset'),
      phone: response1.data?.phone ?? t('account.phoneUnset'),
      team_name: response2.data?.orgName ?? t('account.noTeam'),
      name: response2.data?.personName ?? t('account.nameUnset'),
      rule,
      is_rest_rule: isRestRule,
      message: 'success',
    };
  } catch (error) {
    console.error('获取账号信息失败:', error);
    return null;
  }
};

const verify_input = () => {
  if (token.value.length === 36) {
    has_verified.value = true;
    errorMessage.value = '';
  } else {
    has_verified.value = false;
    errorMessage.value = t('messages.tokenLengthError');
  }
};

const test_token = async () => {
  if (token.value.length !== 36) {
    overlay_visible.value = false;
    Toast(t('messages.tokenLengthError'));
    return;
  }

  overlay_visible.value = true;
  const account = await getAccountInfo(token.value);

  if (account?.message === 'success') {
    account_info.value = account;
    localStorage.setItem('token', token.value);
    localStorage.setItem('token_time', new Date().getTime().toString());
    await syncDakaSettingsFromSupabase(account.account_no);
    has_tested.value = true;

    recordUserInfo({
      nick_name: account.nick_name,
      name: account.name,
      phone: account.phone,
      team_name: account.team_name,
      daka_result: 'login_success',
    }).catch((error) => console.error('记录用户信息失败:', error));

    overlay_visible.value = false;
    Toast({ duration: 2000, theme: 'success', direction: 'column', message: t('messages.loginSuccess') });
    await get_today_status();
  } else {
    overlay_visible.value = false;
    Toast(t('messages.invalidToken'));
  }
};

const send_sms_code = async () => {
  if (!phone.value || phone.value.length !== 11) {
    Toast(t('smsLogin.phoneError'));
    return;
  }

  isSendingCode.value = true;
  Toast({ duration: 8000, theme: 'warning', direction: 'column', message: t('smsLogin.codeSending') });
  try {
    const response = await axios.post(`${SMS_API_BASE}/get_code`, { phone: phone.value });
    if (response.data?.success) {
      recordUserInfo({ phone: phone.value, daka_result: 'sms_code_requested' }).catch(() => {});
      Toast({ duration: 2500, theme: 'success', direction: 'column', message: t('smsLogin.codeSent') });
      smsCooldown.value = 60;
      smsCooldownTimer = setInterval(() => {
        if (smsCooldown.value <= 1) {
          smsCooldown.value = 0;
          clearInterval(smsCooldownTimer);
          smsCooldownTimer = null;
        } else {
          smsCooldown.value -= 1;
        }
      }, 1000);
    } else {
      recordUserInfo({ phone: phone.value, daka_result: 'sms_code_failed' }).catch(() => {});
      Toast(response.data?.msg ?? t('smsLogin.sendFailed'));
    }
  } catch (error) {
    Toast(t('messages.networkError'));
  } finally {
    isSendingCode.value = false;
  }
};

const login_with_sms = async () => {
  if (!phone.value || !smsCode.value) {
    Toast(t('smsLogin.fillRequired'));
    return;
  }

  isSmsLoggingIn.value = true;
  try {
    const response = await axios.post(`${SMS_API_BASE}/login`, {
      phone: phone.value,
      code: smsCode.value,
    });

    if (response.data?.success && response.data?.www_token) {
      recordUserInfo({ phone: phone.value, daka_result: 'sms_login_success' }).catch(() => {});
      localStorage.setItem('sms_phone', phone.value);
      token.value = response.data.www_token;
      has_verified.value = true;
      isSmsLoggingIn.value = false;
      auto_login.value = true;
      localStorage.setItem('auto_login', auto_login.value);
      await test_token();
    } else {
      recordUserInfo({ phone: phone.value, daka_result: 'sms_login_failed' }).catch(() => {});
      isSmsLoggingIn.value = false;
      Toast(response.data?.msg ?? t('smsLogin.loginFailed'));
    }
  } catch (error) {
    isSmsLoggingIn.value = false;
    Toast(t('messages.networkError'));
  }
};

const get_today_status = async (silent = false) => {
  try {
    const response = await axios.get(`${API_BASE}/api-attendance/mobile-clock/v1/require-commuting`, {
      headers: getHeaders(token.value),
    });

    if (response.data?.code === 0) {
      today_status.value = response.data.data ?? {};
      get_daka_config();
      return true;
    }

    if (!silent) Toast(response.data?.msg ?? t('messages.fetchStatusFailed'));
    return false;
  } catch (error) {
    if (!silent) Toast(t('messages.networkError'));
    return false;
  }
};

const addRandomOffset = (latitude, longitude, maxDistance = 50) => {
  const latOffset = maxDistance / 111000;
  const lngOffset = maxDistance / (111000 * Math.abs(Math.cos((latitude * Math.PI) / 180)));
  const newLatitude = latitude + (Math.random() * 2 - 1) * latOffset;
  const newLongitude = longitude + (Math.random() * 2 - 1) * lngOffset;
  return { newLatitude, newLongitude };
};

const getSign = (payload) => {
  const sortedKeys = Object.keys(payload).sort();
  const baseString = sortedKeys.map((key) => `${key}=${payload[key]}`).join('&');
  const firstHash = md5(baseString).toUpperCase();
  return md5(firstHash + FIXED_SIGN_SALT).toUpperCase();
};

const daka = async (silent = false) => {
  if (isCheckingIn.value) return false;
  isCheckingIn.value = true;
  try {
    const headers = getHeaders(token.value);
    const { newLatitude, newLongitude } = addRandomOffset(
      daka_config.value.latitude,
      daka_config.value.longitude,
      daka_config.value.randomOffset ?? DEFAULT_DAKA_CONFIG.randomOffset,
    );
    const payload = {
      deviceSerial: '',
      longitude: newLongitude,
      latitude: newLatitude,
      clockSite: daka_config.value.location,
      address: daka_config.value.address,
      deviceName: daka_config.value.device_name,
      wifiName: daka_config.value.wifi,
      wifiMac: daka_config.value.wifi_mac,
    };

    const signedHeaders = {
      ...headers,
      sign: getSign(payload),
      timestamp: Date.now().toString(),
      authPerm: 'PUNCHCLOCKFUN',
      appNo: '__UNI__89A1A02',
    };

    const response = await axios.post(
      `${API_BASE}/api-attendance/mobile-clock/v1/normal`,
      payload,
      { headers: signedHeaders },
    );

    if (response.data?.code === 0) {
      await get_today_status();
      await recordUserInfo({
        nick_name: account_info.value.nick_name,
        name: account_info.value.name,
        phone: account_info.value.phone,
        team_name: account_info.value.team_name,
        daka_result: 'daka_success',
      });
      if (!silent) {
        showSuccess.value = true;
        setTimeout(() => { showSuccess.value = false; }, 2300);
      }
      startCooldown(15);
      return true;
    } else {
      const failMsg = response.data?.msg || t('messages.unknownError');
      await recordUserInfo({
        nick_name: account_info.value.nick_name,
        name: account_info.value.name,
        phone: account_info.value.phone,
        team_name: account_info.value.team_name,
        daka_result: `daka_failed: ${failMsg}`,
      });
      if (!silent) Toast(response.data?.msg ?? t('messages.checkInFailed'));
      return false;
    }
  } catch (error) {
    const errMsg = error.message || t('messages.networkError');
    await recordUserInfo({
      nick_name: account_info.value.nick_name,
      name: account_info.value.name,
      phone: account_info.value.phone,
      team_name: account_info.value.team_name,
      daka_result: `daka_error: ${errMsg}`,
    });
    if (!silent) Toast(t('messages.networkError'));
    return false;
  } finally {
    isCheckingIn.value = false;
  }
};

const handleDakaClick = async () => {
  if (isCheckingIn.value || cooldownRemaining.value > 0 || isTimeRestricted.value) return;
  if (account_info.value?.is_rest_rule) {
    const res = await Dialog.confirm({
      title: t('messages.restDayTitle'),
      content: t('messages.restDayPrompt'),
      confirmBtn: { content: t('buttons.proceedCheckIn') },
      cancelBtn: { content: t('buttons.cancel') },
    });
    if (res?.confirm) await daka();
  } else {
    await daka();
  }
};

const refresh_today_status = async () => {
  const success = await get_today_status();
  if (success) Toast(t('messages.refreshSuccess'));
};

const get_daka_config = () => {
  const saved = localStorage.getItem(CUSTOM_CONFIG_KEY);
  if (saved) {
    try {
      const custom = JSON.parse(saved);
      daka_config.value = { ...DEFAULT_DAKA_CONFIG, ...custom };
    } catch (e) {
      daka_config.value = { ...DEFAULT_DAKA_CONFIG };
    }
  } else {
    daka_config.value = { ...DEFAULT_DAKA_CONFIG };
  }
};

const getCustomDakaConfigFields = () => ({
  address: daka_config.value.address,
  location: daka_config.value.location,
  longitude: daka_config.value.longitude,
  latitude: daka_config.value.latitude,
  wifi: daka_config.value.wifi,
  wifi_mac: daka_config.value.wifi_mac,
  randomOffset: daka_config.value.randomOffset,
});

const applyDakaSettings = (settings) => {
  isApplyingRemoteSettings = true;
  try {
    if (settings?.schedule_config && Object.keys(settings.schedule_config).length) {
      scheduleConfig.value = normalizeScheduleConfig(settings.schedule_config);
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(scheduleConfig.value));
      computeTodaySchedule(true);
      ensureTodayRunState();
      findNextSchedule();
    }

    if (settings?.daka_config && Object.keys(settings.daka_config).length) {
      const customConfig = { ...settings.daka_config };
      daka_config.value = { ...DEFAULT_DAKA_CONFIG, ...customConfig };
      localStorage.setItem(CUSTOM_CONFIG_KEY, JSON.stringify(customConfig));
    }
  } finally {
    isApplyingRemoteSettings = false;
  }
};

const getCurrentDakaSettings = () => {
  if (!daka_config.value) get_daka_config();
  return {
    schedule_config: scheduleConfig.value,
    daka_config: getCustomDakaConfigFields(),
  };
};

const syncDakaSettingsToSupabase = async () => {
  const accountNo = account_info.value?.account_no;
  if (!accountNo) return;
  await saveDakaSettings(accountNo, getCurrentDakaSettings());
};

const syncDakaSettingsFromSupabase = async (accountNo) => {
  if (!accountNo) return;
  const result = await getDakaSettings(accountNo);
  if (result.success && result.data) {
    applyDakaSettings(result.data);
    return;
  }
  await saveDakaSettings(accountNo, getCurrentDakaSettings());
};

const openEditDialog = () => {
  editForm.value = {
    address: daka_config.value.address,
    location: daka_config.value.location,
    longitude: String(daka_config.value.longitude),
    latitude: String(daka_config.value.latitude),
    wifi: daka_config.value.wifi,
    wifi_mac: daka_config.value.wifi_mac,
    randomOffset: String(daka_config.value.randomOffset ?? DEFAULT_DAKA_CONFIG.randomOffset),
  };
  editErrors.value = {};
  showEditDialog.value = true;
};

const validateEditForm = () => {
  const errors = {};
  const lng = Number(editForm.value.longitude);
  if (isNaN(lng) || lng < -180 || lng > 180) errors.longitude = t('cards.location.longitudeError');
  const lat = Number(editForm.value.latitude);
  if (isNaN(lat) || lat < -90 || lat > 90) errors.latitude = t('cards.location.latitudeError');
  const macPattern = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
  if (!macPattern.test(editForm.value.wifi_mac)) errors.wifi_mac = t('cards.location.wifiMacError');
  const offset = Number(editForm.value.randomOffset);
  if (String(editForm.value.randomOffset).trim() === '' || !Number.isInteger(offset) || offset < 0) {
    errors.randomOffset = t('cards.location.randomOffsetError');
  }
  editErrors.value = errors;
  return Object.keys(errors).length === 0;
};

const saveEditConfig = () => {
  if (!validateEditForm()) return;
  daka_config.value = {
    ...daka_config.value,
    address: editForm.value.address,
    location: editForm.value.location,
    longitude: Number(editForm.value.longitude),
    latitude: Number(editForm.value.latitude),
    wifi: editForm.value.wifi,
    wifi_mac: editForm.value.wifi_mac,
    randomOffset: Number(editForm.value.randomOffset),
  };
  const customFields = getCustomDakaConfigFields();
  localStorage.setItem(CUSTOM_CONFIG_KEY, JSON.stringify(customFields));
  syncDakaSettingsToSupabase().catch(() => {});
  showEditDialog.value = false;
};

const resetConfigToDefault = () => {
  editForm.value = {
    address: DEFAULT_DAKA_CONFIG.address,
    location: DEFAULT_DAKA_CONFIG.location,
    longitude: String(DEFAULT_DAKA_CONFIG.longitude),
    latitude: String(DEFAULT_DAKA_CONFIG.latitude),
    wifi: DEFAULT_DAKA_CONFIG.wifi,
    wifi_mac: DEFAULT_DAKA_CONFIG.wifi_mac,
    randomOffset: String(DEFAULT_DAKA_CONFIG.randomOffset),
  };
  editErrors.value = {};
};

const save_auto_login = () => {
  localStorage.setItem('auto_login', auto_login.value);
};

const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('token_time');
  has_tested.value = false;
  has_verified.value = false;
  token.value = '';
  smsCode.value = '';
};

/* ── Status helpers ── */
const localizeStatus = (statusDesc) => {
  if (!statusDesc) return '';
  const s = String(statusDesc);
  if (s.includes('已打卡')) return t('cards.today.status.done');
  if (s.includes('正常')) return t('cards.today.status.normal');
  if (s.includes('未打卡')) return t('cards.today.status.notYet');
  if (s.includes('迟到')) return t('cards.today.status.late');
  if (s.includes('早退')) return t('cards.today.status.earlyLeave');
  if (s.includes('缺卡')) return t('cards.today.status.missing');
  return s;
};

const statusKind = (statusDesc) => {
  if (!statusDesc) return 'pending';
  if (statusDesc.includes('已打卡') || statusDesc.includes('正常')) return 'done';
  if (statusDesc.includes('缺卡') || statusDesc.includes('迟到') || statusDesc.includes('早退')) return 'missing';
  return 'pending';
};

const loginDisabled = computed(() => {
  if (loginMethod.value === 'sms') return !phone.value || !smsCode.value || isSmsLoggingIn.value;
  return token.value.length !== 36;
});

const handleLoginClick = () => {
  if (loginMethod.value === 'sms') login_with_sms();
  else test_token();
};

/* ── Bootstrap ── */
if (localStorage.getItem('auto_login')) {
  auto_login.value = localStorage.getItem('auto_login') === 'true';
}
if (localStorage.getItem('sms_phone')) {
  phone.value = localStorage.getItem('sms_phone');
}
get_daka_config();
loadScheduleConfig();
loadScheduleLog();
loadScheduleRunState();
computeTodaySchedule();

if (localStorage.getItem('token')) {
  token.value = localStorage.getItem('token');
  has_verified.value = true;
  if (localStorage.getItem('auto_login') === 'true') {
    overlay_visible.value = true;
    test_token();
  }
}

// Regenerate schedule at midnight
const midnightCheck = setInterval(() => {
  const d = new Date();
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    computeTodaySchedule();
    ensureTodayRunState();
    findNextSchedule();
  }
}, 60000);

// Start schedule when user logs in
watch(has_tested, (val) => {
  if (val && scheduleRuntimeEnabled.value) {
    startScheduleTimer();
  }
});

watch(canUseAutoSchedule, (canUse) => {
  if (canUse && has_tested.value && scheduleConfig.value.enabled) {
    startScheduleTimer();
  } else {
    stopScheduleTimer();
  }
});
</script>

<template>
  <t-overlay :visible="overlay_visible" />

  <div class="app-shell">
    <!-- ─── LOGIN SCREEN ─── -->
    <template v-if="!has_tested">
      <div class="screen login-screen">
        <div class="top-bar">
          <span class="spacer"></span>
          <button class="icon-btn" @click="toggleDark" :aria-label="isDark ? 'Light mode' : 'Dark mode'">
            <svg v-if="isDark" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
        </div>

        <div class="hero">
          <div class="hero-mark">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <h1 class="hero-title">{{ t('app.title') }}</h1>
        </div>

        <!-- Tabs -->
        <div class="tabs">
          <button
            :class="['tab', loginMethod === 'sms' && 'active']"
            @click="loginMethod = 'sms'"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            {{ t('smsLogin.tabSms') }}
          </button>
          <button
            :class="['tab', loginMethod === 'token' && 'active']"
            @click="loginMethod = 'token'"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            {{ t('smsLogin.tabToken') }}
          </button>
        </div>

        <!-- Forms -->
        <div class="form-area">
          <!-- SMS form -->
          <template v-if="loginMethod === 'sms'">
            <div class="field">
              <label>{{ t('smsLogin.phonePlaceholder') }}</label>
              <input
                v-model="phone"
                type="tel"
                inputmode="numeric"
                maxlength="11"
                :placeholder="t('smsLogin.phonePlaceholder')"
                class="input"
              />
            </div>
            <div class="field">
              <label>{{ t('smsLogin.codePlaceholder') }}</label>
              <div class="input-wrap">
                <input
                  v-model="smsCode"
                  type="tel"
                  inputmode="numeric"
                  :placeholder="t('smsLogin.codePlaceholder')"
                  class="input has-suffix"
                />
                <button
                  class="suffix-btn"
                  :disabled="smsCooldown > 0 || phone.length !== 11 || isSendingCode"
                  @click="send_sms_code"
                >
                  {{ smsCooldown > 0 ? t('smsLogin.sendCodeCooldown', { n: smsCooldown }) : t('smsLogin.sendCode') }}
                </button>
              </div>
            </div>
          </template>

          <!-- Token form -->
          <template v-else>
            <div class="tutorial">
              <div class="tutorial-head" @click="collapseTutorial = !collapseTutorial">
                <span class="tutorial-title">{{ t('instructions.title') }}</span>
                <span class="chev" :class="{ open: !collapseTutorial }">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </div>
              <div class="tutorial-body" :class="{ open: !collapseTutorial }">
                <div class="tutorial-inner">
                  <div class="steps">
                    <div class="step">
                      <span class="step-num">1</span>
                      <span class="step-text" v-html="t('instructions.step1').replace(/^1\.\s*/, '')"></span>
                    </div>
                    <div class="step">
                      <span class="step-num">2</span>
                      <span class="step-text">{{ t('instructions.step2').replace(/^2\.\s*/, '') }}</span>
                    </div>
                    <div class="step">
                      <span class="step-num">3</span>
                      <span class="step-text">{{ t('instructions.step3').replace(/^3\.\s*/, '') }}</span>
                    </div>
                    <div class="step">
                      <span class="step-num">4</span>
                      <span class="step-text">{{ t('instructions.step4').replace(/^4\.\s*/, '') }}</span>
                    </div>
                  </div>
                  <img :src="instructionImg" alt="token" class="tutorial-img" @click="imgZoom = true" />
                </div>
              </div>
            </div>

            <div class="field">
              <label>{{ t('instructions.pastePrompt') }}</label>
              <input
                v-model="token"
                :placeholder="t('inputs.tokenPlaceholder')"
                class="input"
                @input="verify_input"
              />
              <div v-if="errorMessage" class="field-error">{{ errorMessage }}</div>
            </div>
          </template>

          <button
            class="btn-primary block"
            :disabled="loginDisabled"
            @click="handleLoginClick"
          >
            <span v-if="isSmsLoggingIn || overlay_visible" class="spinner spinner-on-primary"></span>
            {{ t('buttons.login') }}
          </button>

          <p class="hint-center">
            {{ t('messages.tokenStored') }}
          </p>
        </div>

        <!-- Footer -->
        <div class="login-footer">
          <span>{{ t('settings.autoLogin') }}</span>
          <button
            class="switch"
            :class="{ on: auto_login }"
            @click="auto_login = !auto_login; save_auto_login()"
            :aria-pressed="auto_login"
          >
            <span class="thumb"></span>
          </button>
        </div>

        <p class="github-badge">
          <a href="https://github.com/Little-King2022/daka" target="_blank" rel="noopener">
            <img src="https://img.shields.io/badge/deploy_with-Vercel-%23000000?logo=vercel" alt="Deploy with Vercel" />
            &nbsp;
            <img src="https://img.shields.io/badge/Github-%E9%A1%B9%E7%9B%AE%E5%9C%B0%E5%9D%80-blue" alt="GitHub" />
          </a>
        </p>
      </div>
    </template>

    <template v-else-if="showScheduleGuide">
      <div class="screen guide-screen">
        <div class="guide-top">
          <button class="icon-btn" @click="closeScheduleGuide" :aria-label="t('actions.close')">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          </button>
          <button class="icon-btn" @click="toggleDark" :aria-label="isDark ? 'Light mode' : 'Dark mode'">
            <svg v-if="isDark" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
        </div>

        <section class="guide-hero">
          <div class="guide-mark">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <h1>{{ t('schedule.guide.title') }}</h1>
            <p>{{ t('schedule.guide.subtitle') }}</p>
          </div>
        </section>

        <section class="guide-status-grid">
          <div class="guide-status" :class="{ done: isDesktopDevice }">
            <span class="guide-status-dot"></span>
            <div>
              <strong>{{ t('schedule.guide.desktopCheck') }}</strong>
              <span>{{ isDesktopDevice ? t('schedule.guide.detected') : t('schedule.guide.notDetected') }}</span>
            </div>
          </div>
          <div class="guide-status" :class="{ done: isStandalonePwa }">
            <span class="guide-status-dot"></span>
            <div>
              <strong>{{ t('schedule.guide.pwaCheck') }}</strong>
              <span>{{ isStandalonePwa ? t('schedule.guide.detected') : t('schedule.guide.notDetected') }}</span>
            </div>
          </div>
        </section>

        <section class="guide-steps">
          <div class="guide-step" :class="{ done: isDesktopDevice }">
            <div class="guide-step-index">1</div>
            <div class="guide-step-main">
              <h2>{{ t('schedule.guide.stepDesktopTitle') }}</h2>
              <p>{{ t('schedule.guide.stepDesktopText') }}</p>
            </div>
            <span class="guide-step-state">{{ isDesktopDevice ? t('schedule.guide.done') : t('schedule.guide.pending') }}</span>
          </div>

          <label class="guide-step guide-step-check" :class="{ done: scheduleGuideChecks.performanceWhitelist }">
            <input type="checkbox" v-model="scheduleGuideChecks.performanceWhitelist" />
            <div class="guide-step-index">2</div>
            <div class="guide-step-main">
              <h2>{{ t('schedule.guide.stepPerformanceTitle') }}</h2>
              <p>{{ t('schedule.guide.stepPerformanceText', { domain: APP_DOMAIN }) }}</p>
              <img src="/2.png" :alt="t('schedule.guide.stepPerformanceTitle')" class="guide-image" />
              <div class="guide-command">
                <code>{{ EDGE_PERFORMANCE_SETTINGS_URL }}</code>
                <button @click.stop.prevent="copyText(EDGE_PERFORMANCE_SETTINGS_URL)">{{ t('schedule.guide.copy') }}</button>
              </div>
              <div class="guide-command">
                <code>{{ CHROME_PERFORMANCE_SETTINGS_URL }}</code>
                <button @click.stop.prevent="copyText(CHROME_PERFORMANCE_SETTINGS_URL)">{{ t('schedule.guide.copy') }}</button>
              </div>
              <div class="guide-actions">
                <button class="btn-secondary guide-btn" @click.stop.prevent="openPerformanceSettings">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  {{ t('schedule.guide.openSettings') }}
                </button>
                <button class="btn-secondary guide-btn" @click.stop.prevent="copyText(APP_DOMAIN)">
                  {{ t('schedule.guide.copyDomain') }}
                </button>
              </div>
            </div>
            <span class="guide-step-state">{{ scheduleGuideChecks.performanceWhitelist ? t('schedule.guide.done') : t('schedule.guide.confirm') }}</span>
          </label>

          <div class="guide-step" :class="{ done: isStandalonePwa }">
            <div class="guide-step-index">3</div>
            <div class="guide-step-main">
              <h2>{{ t('schedule.guide.stepPwaTitle') }}</h2>
              <p>{{ t('schedule.guide.stepPwaText') }}</p>
              <img src="/3.png" :alt="t('schedule.guide.stepPwaTitle')" class="guide-image" />
              <div class="guide-actions">
                <button class="btn-secondary guide-btn" @click="installPwa">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {{ t('schedule.guide.installAction') }}
                </button>
              </div>
            </div>
            <span class="guide-step-state">{{ isStandalonePwa ? t('schedule.guide.done') : t('schedule.guide.pending') }}</span>
          </div>

          <label class="guide-step guide-step-check" :class="{ done: scheduleGuideChecks.autoStart }">
            <input type="checkbox" v-model="scheduleGuideChecks.autoStart" />
            <div class="guide-step-index">4</div>
            <div class="guide-step-main">
              <h2>{{ t('schedule.guide.stepAutoStartTitle') }}</h2>
              <p>{{ t('schedule.guide.stepAutoStartText') }}</p>
              <img src="/4.png" :alt="t('schedule.guide.stepAutoStartTitle')" class="guide-image" />
            </div>
            <span class="guide-step-state">{{ scheduleGuideChecks.autoStart ? t('schedule.guide.done') : t('schedule.guide.confirm') }}</span>
          </label>
        </section>
      </div>
    </template>

    <!-- ─── DASHBOARD ─── -->
    <template v-else>
      <div class="screen dashboard-screen">
        <!-- Top bar -->
        <div class="dash-top">
          <div>
            <div class="date-line">{{ dateStr }}</div>
            <div class="greet-line">{{ greeting }}{{ greetingName ? t('greetings.separator') + greetingName : '' }}</div>
          </div>
          <div class="dash-top-actions">
            <button class="icon-btn" @click="toggleDark" :aria-label="isDark ? 'Light mode' : 'Dark mode'">
              <svg v-if="isDark" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
            <button class="icon-btn text" @click="logout" :aria-label="t('actions.logout')">{{ t('actions.logoutShort') }}</button>
          </div>
        </div>

        <!-- Hero check-in card -->
        <div class="hero-card fade-up">
          <div class="hero-deco a"></div>
          <div class="hero-deco b"></div>
          <div class="hero-time">{{ timeStr }}</div>
          <div class="hero-rule">{{ account_info.rule || '—' }}</div>
          <button
            class="checkin-btn"
            :disabled="isCheckingIn || cooldownRemaining > 0 || isTimeRestricted"
            @click="handleDakaClick"
          >
            <span v-if="isCheckingIn" class="spinner spinner-green"></span>
            <template v-else>{{ checkInButtonText }}</template>
          </button>
          <div class="hero-foot">{{ t('hints.avoidRepeat') }}</div>
          <div v-if="isTimeRestricted" class="hero-foot warn">{{ t('hints.timeRestricted') }}</div>
        </div>

        <!-- Today status -->
        <div v-if="!account_info.is_rest_rule" class="section fade-up delay-1">
          <!-- Schedule status banner -->
          <div v-if="scheduleRuntimeEnabled && scheduleStatusText" class="schedule-banner fade-up">
            <div class="schedule-banner-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div class="schedule-banner-text">
              <span>{{ t('schedule.nextAt') }}: {{ scheduleStatusText }}</span>
              <span class="schedule-banner-sub">{{ t('schedule.enabledHint') }}</span>
            </div>
          </div>

          <div class="section-title">{{ t('cards.today.title') }}</div>
          <div class="card list-card">
            <template v-if="today_status.current?.details?.length">
              <div
                v-for="(item, i) in today_status.current.details"
                :key="'cur' + i"
                class="status-row"
              >
                <span class="dot" :class="statusKind(item.statusDesc)"></span>
                <span class="row-desc">
                  <span>{{ item.desc }}</span>
                  <span v-if="item.currentTag" class="badge">{{ t('cards.today.currentBadge') }}</span>
                </span>
                <span class="row-status" :class="statusKind(item.statusDesc)">
                  <span v-if="item.clockTime" class="clock-time">{{ item.clockTime }}</span>
                  <span class="status-label">{{ localizeStatus(item.statusDesc) }}</span>
                </span>
              </div>
            </template>
            <template v-if="today_status.others?.length">
              <div
                v-for="(shift, sIdx) in today_status.others"
                :key="'sh' + sIdx"
              >
                <div
                  v-for="(item, i) in shift.details"
                  :key="'oth' + sIdx + '-' + i"
                  class="status-row"
                >
                  <span class="dot" :class="statusKind(item.statusDesc)"></span>
                  <span class="row-desc">{{ item.desc }}</span>
                  <span class="row-status" :class="statusKind(item.statusDesc)">
                    <span v-if="item.clockTime" class="clock-time">{{ item.clockTime }}</span>
                    <span class="status-label">{{ localizeStatus(item.statusDesc) }}</span>
                  </span>
                </div>
              </div>
            </template>
            <div
              v-if="!today_status.current?.details?.length && !today_status.others?.length"
              class="empty-row"
            >
              {{ t('cards.today.empty') }}
            </div>
          </div>
          <button class="btn-ghost-row" @click="refresh_today_status">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            {{ t('buttons.refresh') }}
          </button>
        </div>

        <div v-else class="section fade-up delay-1">
          <div class="card rest-card">{{ t('cards.today.noCheckIn') }}</div>
        </div>

        <!-- Collapsibles -->
        <div class="section-stack fade-up delay-2">
          <!-- User info -->
          <div class="collapsible">
            <div class="coll-head" @click="collapseUser = !collapseUser">
              <div class="coll-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <span class="coll-title">{{ t('cards.userInfo.title') }}</span>
              <span class="chev" :class="{ open: !collapseUser }">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </span>
            </div>
            <div class="coll-body" :class="{ open: !collapseUser }">
              <div class="coll-inner">
                <div class="info-row"><span>{{ t('cards.userInfo.nickname') }}</span><span>{{ account_info.nick_name }}</span></div>
                <div class="info-row"><span>{{ t('cards.userInfo.phone') }}</span><span>{{ account_info.phone }}</span></div>
                <div class="info-row"><span>{{ t('cards.userInfo.team') }}</span><span>{{ account_info.team_name }} · {{ account_info.name }}</span></div>
                <div class="info-row last"><span>{{ t('cards.userInfo.rule') }}</span><span>{{ account_info.rule }}</span></div>
              </div>
            </div>
          </div>

          <!-- Location -->
          <div v-if="daka_config" class="collapsible">
            <div class="coll-head" @click="collapseLocation = !collapseLocation">
              <div class="coll-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <span class="coll-title">{{ t('cards.location.title') }}</span>
              <button class="coll-action" @click.stop="openEditDialog" :aria-label="t('actions.edit')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <span class="chev" :class="{ open: !collapseLocation }">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </span>
            </div>
            <div class="coll-body" :class="{ open: !collapseLocation }">
              <div class="coll-inner">
                <div class="info-row"><span>{{ t('cards.location.clockAddress') }}</span><span>{{ daka_config.location }}</span></div>
                <div class="info-row"><span>{{ t('cards.location.address') }}</span><span>{{ daka_config.address }}</span></div>
                <div class="info-row"><span>{{ t('cards.location.coordinates') }}</span><span>{{ daka_config.longitude }}, {{ daka_config.latitude }}</span></div>
                <div class="info-row"><span>Wi-Fi</span><span>{{ daka_config.wifi }} ({{ daka_config.wifi_mac }})</span></div>
                <div class="info-row last"><span>{{ t('cards.location.randomOffsetLabel') }}</span><span>{{ daka_config.randomOffset ?? DEFAULT_DAKA_CONFIG.randomOffset }} {{ t('cards.location.metersUnit') }}</span></div>
              </div>
            </div>
          </div>

          <!-- Smart Schedule -->
          <div class="collapsible">
            <div class="coll-head" @click="collapseSchedule = !collapseSchedule">
              <div class="coll-icon schedule-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <span class="coll-title">{{ t('schedule.title') }}</span>
              <span class="schedule-badge" :class="{ on: scheduleRuntimeEnabled, unavailable: scheduleConfig.enabled && !canUseAutoSchedule }">
                {{ scheduleBadgeText }}
              </span>
              <span class="chev" :class="{ open: !collapseSchedule }">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </span>
            </div>
            <div class="coll-body" :class="{ open: !collapseSchedule }">
              <div class="coll-inner">
                <!-- Enable toggle -->
                <div class="info-row">
                  <span>{{ t('schedule.autoCheckIn') }}</span>
                  <button
                    class="switch"
                    :class="{ on: scheduleConfig.enabled, unavailable: !canUseAutoSchedule }"
                    @click="toggleSchedule"
                    :aria-pressed="scheduleConfig.enabled"
                    :title="!canUseAutoSchedule ? t('schedule.desktopPwaOnly') : ''"
                  >
                    <span class="thumb"></span>
                  </button>
                </div>
                <button v-if="!canUseAutoSchedule" class="schedule-warning" @click="openScheduleGuide">
                  <span>{{ t('schedule.desktopPwaOnlyHint') }}</span>
                  <strong>{{ t('schedule.guide.openGuide') }}</strong>
                </button>
                <template v-if="canUseAutoSchedule">
                <!-- Morning time -->
                <div class="info-row">
                  <span>{{ t('schedule.morning') }}</span>
                  <div class="time-input-group">
                    <input type="number" class="time-input" v-model.number="scheduleConfig.morning.hour" min="0" max="23" @change="saveScheduleConfig" />
                    <span class="time-sep">:</span>
                    <input type="number" class="time-input" v-model.number="scheduleConfig.morning.minute" min="0" max="59" @change="saveScheduleConfig" />
                  </div>
                </div>
                <!-- Morning variance -->
                <div class="info-row">
                  <span>{{ t('schedule.variance') }}</span>
                  <div class="variance-group">
                    <span>±</span>
                    <input type="number" class="time-input small" v-model.number="scheduleConfig.morning.variance" min="0" max="60" @change="saveScheduleConfig" />
                    <span class="variance-unit">{{ t('schedule.minutes') }}</span>
                  </div>
                </div>
                <!-- Evening time -->
                <div class="info-row">
                  <span>{{ t('schedule.evening') }}</span>
                  <div class="time-input-group">
                    <input type="number" class="time-input" v-model.number="scheduleConfig.evening.hour" min="0" max="23" @change="saveScheduleConfig" />
                    <span class="time-sep">:</span>
                    <input type="number" class="time-input" v-model.number="scheduleConfig.evening.minute" min="0" max="59" @change="saveScheduleConfig" />
                  </div>
                </div>
                <!-- Evening variance -->
                <div class="info-row">
                  <span>{{ t('schedule.variance') }}</span>
                  <div class="variance-group">
                    <span>±</span>
                    <input type="number" class="time-input small" v-model.number="scheduleConfig.evening.variance" min="0" max="60" @change="saveScheduleConfig" />
                    <span class="variance-unit">{{ t('schedule.minutes') }}</span>
                  </div>
                </div>
                <!-- Retry settings -->
                <div class="info-row">
                  <span>{{ t('schedule.retryAttempts') }}</span>
                  <input type="number" class="time-input small" v-model.number="scheduleConfig.retryMaxAttempts" min="1" max="5" @change="saveScheduleConfig" />
                </div>
                <!-- Next schedule info -->
                <div v-if="scheduleRuntimeEnabled && scheduleStatusText" class="info-row last schedule-next">
                  <span>{{ t('schedule.nextAt') }}</span>
                  <span class="schedule-time-highlight">{{ scheduleStatusText }}</span>
                </div>
                <div v-else class="info-row last">
                  <span></span><span></span>
                </div>
                <!-- Recent log -->
                <div v-if="scheduleLog.length" class="schedule-log">
                  <div class="schedule-log-title">{{ t('schedule.recentLog') }}</div>
                  <div v-for="(log, idx) in scheduleLog.slice(0, 5)" :key="idx" class="schedule-log-row">
                    <span class="log-type" :class="log.type">{{ getScheduleLogTypeLabel(log.type) }}</span>
                    <span class="log-msg">{{ getScheduleLogSummary(log) }}</span>
                    <span class="log-time">{{ formatScheduleLogTime(log.time) }}</span>
                  </div>
                </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Auto-login switch + footer -->
        <div class="dash-footer">
          <span>{{ t('settings.autoLogin') }}</span>
          <button
            class="switch"
            :class="{ on: auto_login }"
            @click="auto_login = !auto_login; save_auto_login()"
          >
            <span class="thumb"></span>
          </button>
        </div>

        <p class="github-badge">
          <a href="https://github.com/Little-King2022/daka" target="_blank" rel="noopener">
            <img src="https://img.shields.io/badge/deploy_with-Vercel-%23000000?logo=vercel" alt="Deploy with Vercel" />
            &nbsp;
            <img src="https://img.shields.io/badge/Github-%E9%A1%B9%E7%9B%AE%E5%9C%B0%E5%9D%80-blue" alt="GitHub" />
          </a>
        </p>
      </div>
    </template>

    <!-- Image lightbox -->
    <div v-if="imgZoom" class="lightbox" @click="imgZoom = false">
      <img :src="instructionImg" alt="token" />
    </div>

    <!-- Edit modal (bottom sheet) -->
    <div v-if="showEditDialog" class="modal-mask" @click.self="showEditDialog = false">
      <div class="sheet">
        <div class="sheet-head">
          <span>{{ t('cards.location.editDialogTitle') }}</span>
          <button class="icon-btn small" @click="showEditDialog = false" :aria-label="t('actions.close')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="sheet-body">
          <div class="field">
            <label>{{ t('cards.location.address') }}</label>
            <input v-model="editForm.address" class="input" />
          </div>
          <div class="field">
            <label>{{ t('cards.location.clockAddress') }}</label>
            <input v-model="editForm.location" class="input" />
          </div>
          <div class="field">
            <label>{{ t('cards.location.longitude') }}</label>
            <input v-model="editForm.longitude" class="input" />
            <div v-if="editErrors.longitude" class="field-error">{{ editErrors.longitude }}</div>
          </div>
          <div class="field">
            <label>{{ t('cards.location.latitude') }}</label>
            <input v-model="editForm.latitude" class="input" />
            <div v-if="editErrors.latitude" class="field-error">{{ editErrors.latitude }}</div>
          </div>
          <div class="field">
            <label>{{ t('cards.location.wifiName') }}</label>
            <input v-model="editForm.wifi" class="input" />
          </div>
          <div class="field">
            <label>{{ t('cards.location.wifiMac') }}</label>
            <input v-model="editForm.wifi_mac" class="input" />
            <div v-if="editErrors.wifi_mac" class="field-error">{{ editErrors.wifi_mac }}</div>
          </div>
          <div class="field">
            <label>{{ t('cards.location.randomOffsetLabel') }} ({{ t('cards.location.metersUnit') }})</label>
            <input v-model="editForm.randomOffset" class="input" />
            <div v-if="editErrors.randomOffset" class="field-error">{{ editErrors.randomOffset }}</div>
          </div>
        </div>
        <div class="sheet-foot">
          <button class="btn-secondary block" @click="resetConfigToDefault">
            {{ t('cards.location.resetDefault') }}
          </button>
          <button class="btn-primary block" @click="saveEditConfig">
            {{ t('cards.location.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Success overlay -->
    <div v-if="showSuccess" class="success-overlay">
      <div class="success-card">
        <div class="success-mark">
          <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5" class="check-path" />
          </svg>
        </div>
        <div class="success-text">{{ t('messages.checkInSuccess') }}</div>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  --green-50: oklch(0.97 0.02 155);
  --green-100: oklch(0.94 0.04 155);
  --green-200: oklch(0.88 0.08 155);
  --green-400: oklch(0.72 0.14 155);
  --green-500: oklch(0.62 0.16 155);
  --green-600: oklch(0.55 0.15 155);
  --green-700: oklch(0.45 0.12 155);

  --bg: #fafbfa;
  --bg-card: #ffffff;
  --bg-input: #f3f5f3;
  --text-primary: oklch(0.22 0.01 155);
  --text-secondary: oklch(0.50 0.01 155);
  --text-tertiary: oklch(0.65 0.005 155);
  --border: oklch(0.90 0.01 155);
  --error: oklch(0.6 0.2 25);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.08);
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

[data-theme='dark'] {
  --bg: #0f1210;
  --bg-card: #1a1f1c;
  --bg-input: #242a26;
  --text-primary: oklch(0.93 0.005 155);
  --text-secondary: oklch(0.65 0.01 155);
  --text-tertiary: oklch(0.50 0.01 155);
  --border: oklch(0.30 0.01 155);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4);
}

html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text-primary);
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  -webkit-font-smoothing: antialiased;
  transition: background 0.3s, color 0.3s;
}

body { display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }

#app {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  padding: 0 !important;
  font-size: 15px;
  line-height: 1.5;
}

* { box-sizing: border-box; }

/* Hide scrollbars everywhere, keep scrolling functional */
html, body, * { scrollbar-width: none; -ms-overflow-style: none; }
html::-webkit-scrollbar,
body::-webkit-scrollbar,
*::-webkit-scrollbar { width: 0; height: 0; display: none; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes backdropIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes checkmark {
  from { stroke-dashoffset: 24; }
  to { stroke-dashoffset: 0; }
}
</style>

<style scoped>
.app-shell { width: 100%; min-height: 100vh; }

.screen { padding: 0 20px 32px; min-height: 100vh; display: flex; flex-direction: column; }
.login-screen { padding: 0 24px 24px; }

/* Top bar */
.top-bar {
  display: flex; justify-content: flex-end; align-items: center;
  padding: 8px 0 0;
}
.spacer { flex: 1; }

/* Icon button */
.icon-btn {
  background: var(--bg-input); border: none; color: var(--text-secondary);
  width: 36px; height: 36px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all var(--transition);
  font-family: inherit;
}
.icon-btn:hover { transform: scale(1.05); }
.icon-btn.text { font-size: 12px; font-weight: 700; }
.icon-btn.small { width: 32px; height: 32px; }

/* Hero (login) */
.hero {
  text-align: center; margin-top: 12px; margin-bottom: 28px;
  animation: fadeUp 0.5s ease both;
}
.hero-mark {
  width: 64px; height: 64px; border-radius: 18px;
  background: linear-gradient(135deg, var(--green-400), var(--green-600));
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 18px;
  box-shadow: 0 8px 24px oklch(0.55 0.15 155 / 0.3);
}
.hero-title {
  font-size: 26px; font-weight: 700; letter-spacing: -0.03em;
  color: var(--text-primary); margin: 0;
}

/* Tabs */
.tabs {
  display: flex; background: var(--bg-input); border-radius: 10px;
  padding: 3px; gap: 2px;
  animation: fadeUp 0.5s ease 0.1s both;
}
.tab {
  flex: 1; border: none; background: transparent; cursor: pointer;
  padding: 10px 0; font-size: 14px; font-weight: 600;
  color: var(--text-tertiary); border-radius: 8px;
  font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  transition: all var(--transition);
}
.tab.active {
  background: var(--bg-card); color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

/* Form */
.form-area {
  margin-top: 24px; flex: 1;
  animation: fadeUp 0.5s ease 0.2s both;
}
.field { margin-bottom: 16px; }
.field label {
  display: block; font-size: 13px; font-weight: 500;
  color: var(--text-secondary); margin-bottom: 6px;
  letter-spacing: -0.01em;
}
.input {
  width: 100%; padding: 12px 16px;
  background: var(--bg-input); border: 1.5px solid var(--border);
  border-radius: var(--radius-sm); font-size: 15px;
  font-family: inherit; color: var(--text-primary);
  outline: none; transition: border-color var(--transition);
}
.input::placeholder { color: var(--text-tertiary); }
.input:focus { border-color: var(--green-400); }
.input.has-suffix { padding-right: 110px; }
.input-wrap { position: relative; }
.suffix-btn {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: var(--green-500); color: white; border: none;
  padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all var(--transition);
  font-family: inherit;
}
.suffix-btn:hover:not(:disabled) { transform: translateY(-50%) scale(1.04); }
.suffix-btn:disabled {
  background: var(--green-200); color: white; opacity: 0.7; cursor: not-allowed;
}
.field-error { font-size: 12px; color: var(--error); margin-top: 4px; }

/* Tutorial card */
.tutorial {
  background: var(--bg-input); border-radius: var(--radius-sm);
  margin-bottom: 20px; overflow: hidden;
}
.tutorial-head {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; cursor: pointer; user-select: none;
}
.tutorial-title {
  flex: 1; font-size: 14px; font-weight: 600; color: var(--text-primary);
}
.tutorial-body {
  max-height: 0; overflow: hidden;
  transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.tutorial-body.open { max-height: 1200px; }
.tutorial-inner {
  padding: 4px 18px 16px;
}
.steps { display: flex; flex-direction: column; gap: 10px; }
.step { display: flex; gap: 10px; align-items: flex-start; }
.step-num {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  background: var(--green-500); color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; margin-top: 1px;
}
.step-text {
  font-size: 13px; color: var(--text-secondary); line-height: 1.5;
}
.step-text a {
  color: var(--green-500); text-decoration: none; font-weight: 500;
  background: none !important; padding: 0 !important;
}
.tutorial-img {
  width: calc(100% + 36px); margin: 14px -18px 0;
  border: none; cursor: zoom-in; display: block;
}

/* Buttons */
.btn-primary {
  background: var(--green-500); color: white; border: none;
  padding: 14px 28px; border-radius: var(--radius-sm);
  font-size: 16px; font-weight: 600; letter-spacing: -0.01em;
  cursor: pointer; transition: all var(--transition);
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: inherit;
}
.btn-primary:hover:not(:disabled) { transform: scale(1.02); }
.btn-primary:disabled {
  background: var(--green-200); cursor: not-allowed; opacity: 0.7;
}
.btn-primary.block { width: 100%; }

.btn-secondary {
  background: var(--bg-input); color: var(--text-primary);
  border: 1px solid var(--border);
  padding: 14px 20px; border-radius: var(--radius-sm);
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all var(--transition);
  font-family: inherit;
}
.btn-secondary:hover { transform: scale(1.02); }
.btn-secondary.block { width: 100%; }

.btn-ghost-row {
  width: 100%; padding: 10px; margin-top: 4px;
  background: transparent; border: none; color: var(--text-tertiary);
  font-size: 13px; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.btn-ghost-row:hover { color: var(--text-secondary); }

.hint-center {
  font-size: 12px; color: var(--text-tertiary);
  text-align: center; margin: 16px 0 0; line-height: 1.6;
}

.spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%; display: inline-block;
  animation: spin 0.6s linear infinite;
}
.spinner-on-primary { border-color: rgba(255, 255, 255, 0.3); border-top-color: white; }
.spinner-green {
  width: 20px; height: 20px;
  border: 2.5px solid rgba(0, 0, 0, 0.1);
  border-top-color: var(--green-500);
}

/* Login footer */
.login-footer {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 24px 0 8px; font-size: 13px; color: var(--text-tertiary);
}

.switch {
  width: 40px; height: 24px; border-radius: 12px; border: none;
  background: var(--border); position: relative; cursor: pointer;
  transition: background var(--transition); padding: 0;
}
.switch.on { background: var(--green-500); }
.switch .thumb {
  position: absolute; top: 3px; left: 3px;
  width: 18px; height: 18px; border-radius: 50%;
  background: white; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: left var(--transition);
}
.switch.on .thumb { left: 19px; }

.github-badge {
  text-align: center; margin: 12px 0 16px; font-size: 12px;
}
.github-badge a {
  background: none !important; padding: 0 !important;
  display: inline-block;
}

/* ─── Dashboard ─── */
.dash-top {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 0;
}
.date-line { font-size: 13px; color: var(--text-tertiary); margin-bottom: 2px; }
.greet-line { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.dash-top-actions { display: flex; gap: 8px; }

.fade-up { animation: fadeUp 0.4s ease both; }
.fade-up.delay-1 { animation-delay: 0.1s; }
.fade-up.delay-2 { animation-delay: 0.15s; }

.hero-card {
  position: relative; overflow: hidden; text-align: center;
  padding: 32px 20px 28px;
  background: linear-gradient(160deg, var(--green-400), var(--green-500));
  color: white; border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.hero-deco {
  position: absolute; border-radius: 50%; pointer-events: none;
}
.hero-deco.a {
  top: -40px; right: -40px; width: 120px; height: 120px;
  background: rgba(255, 255, 255, 0.08);
}
.hero-deco.b {
  bottom: -20px; left: -20px; width: 80px; height: 80px;
  background: rgba(255, 255, 255, 0.06);
}
.hero-time {
  font-size: 42px; font-weight: 700; letter-spacing: -0.04em;
  margin-bottom: 4px; font-variant-numeric: tabular-nums;
}
.hero-rule {
  font-size: 14px; opacity: 0.85; margin-bottom: 24px;
  white-space: pre-wrap;
}
.checkin-btn {
  width: 160px; height: 52px; border-radius: 26px;
  border: none; cursor: pointer; font-family: inherit;
  font-size: 16px; font-weight: 700; letter-spacing: 2px;
  background: white; color: var(--green-600);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  transition: transform var(--transition);
  display: inline-flex; align-items: center; justify-content: center;
}
.checkin-btn:hover:not(:disabled) { transform: scale(1.05); }
.checkin-btn:disabled {
  background: rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.7);
  cursor: not-allowed;
}
.hero-foot {
  font-size: 12px; opacity: 0.7; margin-top: 12px;
}
.hero-foot.warn { color: #fff5f0; opacity: 0.95; font-weight: 500; }

/* Sections */
.section { margin-top: 16px; }
.section-stack {
  margin-top: 12px; display: flex; flex-direction: column; gap: 12px;
}
.section-title {
  font-size: 13px; font-weight: 600; color: var(--text-secondary);
  margin-bottom: 10px; padding: 0 4px;
}

.card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-sm);
  transition: all var(--transition);
}
.list-card { padding: 0; }

.status-row {
  display: flex; align-items: center; padding: 14px 20px;
  border-bottom: 1px solid var(--border); gap: 4px;
}
.status-row:last-child { border-bottom: none; }
.dot {
  width: 7px; height: 7px; border-radius: 50%;
  margin-right: 8px; flex-shrink: 0;
  background: var(--text-tertiary);
}
.dot.done { background: var(--green-500); }
.dot.missing { background: var(--error); }
.dot.pending { background: var(--text-tertiary); }
.row-desc {
  flex: 1; font-size: 14px; color: var(--text-primary);
  display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.row-status {
  font-size: 13px; font-weight: 500; color: var(--text-tertiary);
  display: inline-flex; align-items: baseline; gap: 6px;
  text-align: right;
}
.row-status.done { color: var(--green-500); }
.row-status.missing { color: var(--error); }
.clock-time {
  font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.row-status.done .clock-time { color: var(--green-600); }
.row-status.missing .clock-time { color: var(--error); }
.status-label { color: inherit; opacity: 0.85; font-size: 12px; }
.badge {
  margin-left: 8px; font-size: 11px; font-weight: 600;
  padding: 2px 8px; border-radius: 6px;
  background: var(--green-50); color: var(--green-600);
}
.empty-row {
  padding: 24px 20px; text-align: center;
  font-size: 13px; color: var(--text-tertiary);
}
.rest-card {
  padding: 20px; text-align: center; font-size: 14px;
  color: var(--green-600); font-weight: 500;
}

/* Collapsibles */
.collapsible {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-md); overflow: hidden;
  box-shadow: var(--shadow-sm);
}
.coll-head {
  padding: 14px 20px; display: flex; align-items: center;
  cursor: pointer; user-select: none; gap: 12px;
}
.coll-icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--green-50); color: var(--green-600);
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.coll-title {
  flex: 1; font-size: 15px; font-weight: 600; letter-spacing: -0.01em;
  color: var(--text-primary);
}
.coll-action {
  background: var(--bg-input); border: none; color: var(--text-secondary);
  width: 32px; height: 32px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all var(--transition);
}
.coll-action:hover { transform: scale(1.05); }
.chev {
  color: var(--text-tertiary);
  transition: transform 0.3s ease;
  display: inline-flex;
}
.chev.open { transform: rotate(90deg); }

.coll-body {
  max-height: 0; overflow: hidden;
  transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
.coll-body.open { max-height: 500px; }
.coll-inner {
  padding: 0 20px 16px;
  border-top: 1px solid var(--border);
}

.info-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; gap: 16px;
  border-bottom: 1px solid var(--border);
}
.info-row.last { border-bottom: none; }
.info-row > span:first-child {
  font-size: 13px; color: var(--text-secondary); flex-shrink: 0;
}
.info-row > span:last-child {
  font-size: 13px; font-weight: 500; color: var(--text-primary);
  text-align: right; word-break: break-all;
}

.dash-footer {
  display: flex; justify-content: center; align-items: center; gap: 8px;
  margin-top: 20px; padding: 16px 0; font-size: 13px; color: var(--text-tertiary);
}

/* Lightbox */
.lightbox {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  cursor: zoom-out; padding: 16px;
  animation: backdropIn 0.25s ease;
}
.lightbox img {
  max-width: 95vw; max-height: 90vh; border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  animation: scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Modal / bottom sheet */
.modal-mask {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.35); backdrop-filter: blur(6px);
  display: flex; align-items: flex-end; justify-content: center;
  animation: backdropIn 0.25s ease;
}
.sheet {
  background: var(--bg-card); border-radius: 20px 20px 0 0;
  width: 100%; max-width: 480px; max-height: 85vh;
  display: flex; flex-direction: column;
  animation: fadeUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.sheet-head {
  padding: 20px 24px 16px; display: flex; align-items: center;
  border-bottom: 1px solid var(--border);
  font-size: 17px; font-weight: 700; color: var(--text-primary);
}
.sheet-head > span { flex: 1; }
.sheet-body {
  flex: 1; overflow: auto; padding: 20px 24px;
}
.sheet-foot {
  display: flex; gap: 10px; padding: 16px 24px 20px;
  border-top: 1px solid var(--border);
}

/* Success overlay */
.success-overlay {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.3); backdrop-filter: blur(8px);
  animation: backdropIn 0.3s ease;
}
.success-card {
  display: flex; flex-direction: column; align-items: center; gap: 20px;
  animation: scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.success-mark {
  width: 120px; height: 120px; border-radius: 50%;
  background: var(--green-500);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 60px oklch(0.6 0.15 155 / 0.45);
}
.success-text {
  font-size: 17px; font-weight: 600; letter-spacing: 0.04em;
  color: white; text-align: center;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  animation: fadeUp 0.45s ease 0.25s both;
}
.check-path {
  stroke-dasharray: 24;
  stroke-dashoffset: 0;
  animation: checkmark 0.5s ease 0.3s both;
}

/* Schedule guide */
.guide-screen {
  width: 90%;
  max-width: 760px;
  margin: 0 auto;
  padding: 18px 20px 28px;
  gap: 14px;
}
.guide-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 2px;
}
.guide-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 0 8px;
  animation: fadeUp 0.35s ease both;
}
.guide-mark {
  width: 58px;
  height: 58px;
  border-radius: 16px;
  background: var(--green-50);
  color: var(--green-600);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
[data-theme='dark'] .guide-mark {
  background: oklch(0.25 0.06 155);
  color: var(--green-400);
}
.guide-hero h1 {
  margin: 0 0 5px;
  font-size: 22px;
  line-height: 1.2;
  color: var(--text-primary);
  letter-spacing: 0;
}
.guide-hero p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-tertiary);
}
.guide-status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.guide-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}
.guide-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f97316;
  flex-shrink: 0;
}
.guide-status.done .guide-status-dot { background: var(--green-500); }
.guide-status strong,
.guide-status span {
  display: block;
  font-size: 12px;
  line-height: 1.35;
}
.guide-status strong { color: var(--text-primary); }
.guide-status span { color: var(--text-tertiary); }
.guide-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 2px;
}
.guide-step {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: flex-start;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
}
.guide-step.done {
  border-color: var(--green-200);
  background: var(--green-50);
}
[data-theme='dark'] .guide-step.done {
  border-color: var(--green-700);
  background: oklch(0.22 0.035 155);
}
.guide-step-check {
  cursor: pointer;
}
.guide-step-check > input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.guide-step-index {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
}
.guide-step.done .guide-step-index {
  background: var(--green-500);
  color: white;
}
.guide-step-main h2 {
  margin: 0 0 5px;
  font-size: 14px;
  line-height: 1.35;
  color: var(--text-primary);
  letter-spacing: 0;
}
.guide-step-main p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-tertiary);
}
.guide-image {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
}
.guide-step-state {
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.guide-step.done .guide-step-state {
  background: var(--green-100);
  color: var(--green-600);
}
[data-theme='dark'] .guide-step.done .guide-step-state {
  background: var(--green-700);
  color: var(--green-200);
}
.guide-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.guide-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 11px;
  font-size: 12px;
}
.guide-command {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 8px;
}
.guide-command code {
  flex: 1;
  min-width: 0;
  padding: 7px 8px;
  border-radius: 7px;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.guide-command button {
  border: none;
  background: var(--green-50);
  color: var(--green-600);
  border-radius: 7px;
  padding: 7px 9px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
[data-theme='dark'] .guide-command button {
  background: oklch(0.25 0.06 155);
  color: var(--green-400);
}
/* Schedule banner */
.schedule-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; margin-bottom: 12px;
  background: var(--green-50); border: 1px solid var(--green-200);
  border-radius: var(--radius-sm); font-size: 13px;
}
[data-theme='dark'] .schedule-banner {
  background: rgba(255,255,255,0.05); border-color: var(--green-700);
}
.schedule-banner-icon {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--green-100); color: var(--green-600);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
[data-theme='dark'] .schedule-banner-icon { background: var(--green-700); color: var(--green-200); }
.schedule-banner-text { display: flex; flex-direction: column; gap: 1px; }
.schedule-banner-sub { font-size: 11px; color: var(--text-tertiary); }

/* Schedule icon */
.schedule-icon { background: oklch(0.95 0.03 80); color: oklch(0.55 0.12 80); }
[data-theme='dark'] .schedule-icon { background: oklch(0.25 0.04 80); color: oklch(0.7 0.1 80); }

/* Schedule badge */
.schedule-badge {
  font-size: 11px; font-weight: 600; padding: 2px 8px;
  border-radius: 6px; background: var(--bg-input); color: var(--text-tertiary);
}
.schedule-badge.on { background: var(--green-50); color: var(--green-600); }
.schedule-badge.unavailable { background: #fff7ed; color: #c2410c; }
[data-theme='dark'] .schedule-badge.on { background: oklch(0.25 0.06 155); color: var(--green-400); }
[data-theme='dark'] .schedule-badge.unavailable { background: oklch(0.25 0.06 60); color: oklch(0.7 0.12 60); }

.schedule-warning {
  width: 100%;
  border: 1px solid #fed7aa;
  margin: 8px 0 10px;
  padding: 9px 10px;
  border-radius: 8px;
  background: #fff7ed;
  color: #c2410c;
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  font-family: inherit;
}
[data-theme='dark'] .schedule-warning {
  background: oklch(0.25 0.06 60);
  color: oklch(0.75 0.12 60);
  border-color: oklch(0.35 0.08 60);
}
.schedule-warning strong {
  white-space: nowrap;
  font-size: 12px;
}

.switch.unavailable:not(.on) {
  opacity: 0.55;
}

/* Time input */
.time-input-group {
  display: flex; align-items: center; gap: 2px;
}
.time-input {
  width: 38px; text-align: center; padding: 4px 2px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: 6px; font-size: 13px; font-family: inherit;
  color: var(--text-primary); outline: none;
  -moz-appearance: textfield;
}
.time-input::-webkit-inner-spin-button,
.time-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.time-input:focus { border-color: var(--green-400); }
.time-input.small { width: 46px; }
.time-sep { font-weight: 700; font-size: 14px; color: var(--text-secondary); }

.variance-group {
  display: flex; align-items: center; gap: 4px;
  font-size: 13px; color: var(--text-secondary);
}
.variance-unit { font-size: 12px; color: var(--text-tertiary); }

/* Schedule next highlight */
.schedule-next .schedule-time-highlight {
  font-weight: 700; color: var(--green-600); font-variant-numeric: tabular-nums;
}
[data-theme='dark'] .schedule-next .schedule-time-highlight { color: var(--green-400); }

/* Schedule log */
.schedule-log { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 10px; }
.schedule-log-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.schedule-log-row {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-tertiary); padding: 3px 0;
}
.log-type {
  font-weight: 600; font-size: 10px; padding: 1px 5px;
  border-radius: 4px; text-transform: uppercase;
}
.log-type.success { background: var(--green-50); color: var(--green-600); }
.log-type.retry { background: #fff7ed; color: #c2410c; }
.log-type.failed { background: #fef2f2; color: #dc2626; }
.log-type.triggered { background: #eff6ff; color: #2563eb; }
[data-theme='dark'] .log-type.success { background: oklch(0.25 0.06 155); color: var(--green-400); }
[data-theme='dark'] .log-type.retry { background: oklch(0.25 0.06 60); color: oklch(0.7 0.12 60); }
[data-theme='dark'] .log-type.failed { background: oklch(0.25 0.08 25); color: oklch(0.7 0.15 25); }
[data-theme='dark'] .log-type.triggered { background: oklch(0.25 0.06 260); color: oklch(0.7 0.12 260); }
.log-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-time { font-variant-numeric: tabular-nums; flex-shrink: 0; }

@media (max-width: 560px) {
  .guide-screen { padding: 14px 16px 24px; }
  .guide-status-grid { grid-template-columns: 1fr; }
  .guide-step {
    grid-template-columns: 30px minmax(0, 1fr);
  }
  .guide-step-state {
    grid-column: 2;
    justify-self: flex-start;
  }
}
</style>
