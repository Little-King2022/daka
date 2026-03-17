<script setup>
import { ref, h, computed, onBeforeUnmount } from 'vue';
import { Toast, Dialog } from 'tdesign-mobile-vue';
import axios from 'axios';
import md5 from './utils/md5';
import { IconFont, CloseIcon, CheckIcon, EditIcon } from 'tdesign-icons-vue-next';
import { recordUserInfo } from './utils/supabase';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const API_BASE = 'https://api.hikiot.com';
const SMS_API_BASE = 'https://hiklogin.littleking.site/api';
const FIXED_SIGN_SALT = 'WE1mfER7artAoJEwXKaCjw==';
const REST_KEYWORD = '休息';
const CUSTOM_CONFIG_KEY = 'daka_config_custom';
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

const icons = [h(CheckIcon, { size: '20px' }), h(CloseIcon, { size: '20px' })];

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

const showEditDialog = ref(false);
const editForm = ref({});
const editErrors = ref({});

const loginMethod = ref('token'); // 'token' | 'sms'
const phone = ref('');
const smsCode = ref('');
const smsCooldown = ref(0);
let smsCooldownTimer = null;

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
  if (smsCooldownTimer) {
    clearInterval(smsCooldownTimer);
    smsCooldownTimer = null;
  }
});

const checkInButtonText = computed(() => {
  const baseText = t('buttons.primaryCheckIn');
  if (cooldownRemaining.value > 0) {
    return `${baseText} (${cooldownRemaining.value}s)`;
  }
  return baseText;
});

const isCollapsed1 = ref(true);
const isCollapsed2 = ref(true);
isCollapsed1.value = localStorage.getItem('isCollapsed1') === 'true';
isCollapsed2.value = localStorage.getItem('isCollapsed2') === 'true';

const getHeaders = (authToken) => ({
  'Authorization': `Bearer ${authToken}`,
  'terminal': '0',
  'UNI-Request-Source': '4',
  'Pragma': 'no-cache',
  'content-type': 'application/json',
});

const getMonthQuery = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
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

    if (response1?.code !== 0 || response2?.code !== 0 || response3?.code !== 0) {
      return null;
    }

    if (!response1?.data || !response2?.data || !response3?.data) {
      return null;
    }

    const ruleText = response3.data?.shiftDetail ?? '';
    const hasRule = !!ruleText;
    const isRestRule = typeof ruleText === 'string' && ruleText.includes(REST_KEYWORD);

    let rule = hasRule ? ruleText : t('account.ruleUnset');
    if (isRestRule) {
      rule = t('messages.ruleRestLabel');
    }

    return {
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
    has_tested.value = true;
    account_info.value = account;
    localStorage.setItem('token', token.value);
    localStorage.setItem('token_time', new Date().getTime().toString());

    recordUserInfo({
      nick_name: account.nick_name,
      name: account.name,
      phone: account.phone,
      team_name: account.team_name,
      daka_result: 'login_success'
    }).catch((error) => {
      console.error('记录用户信息失败:', error);
    });

    overlay_visible.value = false;
    Toast({
      duration: 3000,
      theme: 'success',
      direction: 'column',
      message: t('messages.loginSuccess'),
    });
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

  overlay_visible.value = true;
  try {
    const response = await axios.post(`${SMS_API_BASE}/get_code`, { phone: phone.value });
    overlay_visible.value = false;

    if (response.data?.success) {
      Toast({ duration: 3000, theme: 'success', direction: 'column', message: t('smsLogin.codeSent') });
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
      Toast(response.data?.msg ?? t('smsLogin.sendFailed'));
    }
  } catch (error) {
    overlay_visible.value = false;
    Toast(t('messages.networkError'));
  }
};

const login_with_sms = async () => {
  if (!phone.value || !smsCode.value) {
    Toast(t('smsLogin.fillRequired'));
    return;
  }

  overlay_visible.value = true;
  try {
    const response = await axios.post(`${SMS_API_BASE}/login`, {
      phone: phone.value,
      code: smsCode.value,
    });

    if (response.data?.success && response.data?.www_token) {
      token.value = response.data.www_token;
      has_verified.value = true;
      await test_token();
    } else {
      overlay_visible.value = false;
      Toast(response.data?.msg ?? t('smsLogin.loginFailed'));
    }
  } catch (error) {
    overlay_visible.value = false;
    Toast(t('messages.networkError'));
  }
};

const get_today_status = async () => {
  try {
    const response = await axios.get(`${API_BASE}/api-attendance/mobile-clock/v1/require-commuting`, {
      headers: getHeaders(token.value),
    });

    if (response.data?.code === 0) {
      today_status.value = response.data.data ?? {};
      get_daka_config();
      return true;
    }

    Toast(response.data?.msg ?? t('messages.fetchStatusFailed'));
    return false;
  } catch (error) {
    Toast(t('messages.networkError'));
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

const daka = async () => {
  if (isCheckingIn.value) {
    return;
  }

  isCheckingIn.value = true;
  try {
    const headers = getHeaders(token.value);
    const { newLatitude, newLongitude } = addRandomOffset(daka_config.value.latitude, daka_config.value.longitude, daka_config.value.randomOffset ?? DEFAULT_DAKA_CONFIG.randomOffset);
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
        daka_result: 'daka_success'
      });

      Toast({
        duration: 3000,
        theme: 'success',
        direction: 'column',
        message: t('messages.checkInSuccess'),
      });
      startCooldown(15);
    } else {
      await recordUserInfo({
        nick_name: account_info.value.nick_name,
        name: account_info.value.name,
        phone: account_info.value.phone,
        team_name: account_info.value.team_name,
        daka_result: `daka_failed: ${response.data?.msg || t('messages.unknownError')}`
      });

      Toast(response.data?.msg ?? t('messages.checkInFailed'));
    }
  } catch (error) {
    await recordUserInfo({
      nick_name: account_info.value.nick_name,
      name: account_info.value.name,
      phone: account_info.value.phone,
      team_name: account_info.value.team_name,
      daka_result: `daka_error: ${error.message || t('messages.networkError')}`
    });

    Toast(t('messages.networkError'));
  } finally {
    isCheckingIn.value = false;
  }
};

const handleDakaClick = async () => {
  if (isCheckingIn.value || cooldownRemaining.value > 0) {
    return;
  }

  if (account_info.value?.is_rest_rule) {
    const res = await Dialog.confirm({
      title: t('messages.restDayTitle'),
      content: t('messages.restDayPrompt'),
      confirmBtn: { content: t('buttons.proceedCheckIn') },
      cancelBtn: { content: t('buttons.cancel') },
    });
    if (res?.confirm) {
      await daka();
    }
  } else {
    await daka();
  }
};

const refresh_today_status = async () => {
  const success = await get_today_status();
  if (success) {
    Toast(t('messages.refreshSuccess'));
  }
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
  if (isNaN(lng) || lng < -180 || lng > 180) {
    errors.longitude = t('cards.location.longitudeError');
  }
  const lat = Number(editForm.value.latitude);
  if (isNaN(lat) || lat < -90 || lat > 90) {
    errors.latitude = t('cards.location.latitudeError');
  }
  const macPattern = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
  if (!macPattern.test(editForm.value.wifi_mac)) {
    errors.wifi_mac = t('cards.location.wifiMacError');
  }
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
  const customFields = {
    address: daka_config.value.address,
    location: daka_config.value.location,
    longitude: daka_config.value.longitude,
    latitude: daka_config.value.latitude,
    wifi: daka_config.value.wifi,
    wifi_mac: daka_config.value.wifi_mac,
    randomOffset: daka_config.value.randomOffset,
  };
  localStorage.setItem(CUSTOM_CONFIG_KEY, JSON.stringify(customFields));
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

const toggleCard = (index) => {
  if (index === 1) {
    isCollapsed1.value = !isCollapsed1.value;
    localStorage.setItem('isCollapsed1', isCollapsed1.value);
  } else if (index === 2) {
    isCollapsed2.value = !isCollapsed2.value;
    localStorage.setItem('isCollapsed2', isCollapsed2.value);
  }
};

const save_auto_login = () => {
  localStorage.setItem('auto_login', auto_login.value);
};

if (localStorage.getItem('auto_login')) {
  auto_login.value = localStorage.getItem('auto_login') === 'true';
}

get_daka_config();

if (localStorage.getItem('token')) {
  token.value = localStorage.getItem('token');
  has_verified.value = true;
  if (localStorage.getItem('auto_login') === 'true') {
    overlay_visible.value = true;
    test_token();
  }
}
</script>

<template>
  <t-overlay :visible="overlay_visible" />
  <div v-if="!has_tested">
    <h1 style="text-align: center;">{{ t('app.title') }}</h1>
    <t-divider />
  </div>

  <div v-if="!has_tested">
    <!-- Login method tabs -->
    <div class="login-tabs">
      <button
        :class="['login-tab-btn', loginMethod === 'token' ? 'active' : '']"
        @click="loginMethod = 'token'"
      >{{ t('smsLogin.tabToken') }}</button>
      <button
        :class="['login-tab-btn', loginMethod === 'sms' ? 'active' : '']"
        @click="loginMethod = 'sms'"
      >{{ t('smsLogin.tabSms') }}</button>
    </div>

    <!-- Token login -->
    <div v-if="loginMethod === 'token'">
      <p style="font-size: larger;font-weight: bold;text-align: center;margin: 20px auto 20px;">
        {{ t('instructions.title') }}
      </p>
      <p style="font-size: large;" v-html="t('instructions.step1')"></p>
      <p style="font-size: large;">{{ t('instructions.step2') }}</p>
      <p style="font-size: large;">{{ t('instructions.step3') }}</p>
      <p style="font-size: large;">{{ t('instructions.step4') }}</p>
      <img src="./assets/instruction.png" alt="token" style="display: block;margin: 0 auto;width: 100%;">
      <t-divider />
      <p style="font-size: larger;font-weight: bold;text-align: center;margin: 20px auto 20px;">
        {{ t('instructions.pastePrompt') }}
      </p>
      <t-input
        v-model="token"
        :placeholder="t('inputs.tokenPlaceholder')"
        class="home-input"
        @change="verify_input"
        :tips="errorMessage"
      ></t-input>
      <div v-if="has_verified" style="text-align: center;">
        <div style="text-align: center;margin: 0 auto 20px;width: 70%;">
          <t-button theme="primary" variant="light" @click="test_token" block>{{ t('buttons.login') }}</t-button>
        </div>
        <div style="text-align: center;font-size: small; color: grey;margin-top: 10px;">
          {{ t('messages.tokenStored') }}
        </div>
        <div style="text-align: center;font-size: small; color: grey;">
          {{ t('messages.tokenExpiry') }}
        </div>
      </div>
    </div>

    <!-- SMS login -->
    <div v-if="loginMethod === 'sms'" class="sms-login-container">
      <p style="font-size: larger;font-weight: bold;text-align: center;margin: 20px auto 20px;">
        {{ t('smsLogin.title') }}
      </p>
      <t-input
        v-model="phone"
        :placeholder="t('smsLogin.phonePlaceholder')"
        class="home-input"
        type="tel"
      ></t-input>
      <div class="sms-code-row">
        <t-input
          v-model="smsCode"
          :placeholder="t('smsLogin.codePlaceholder')"
          class="sms-code-input"
          type="tel"
        ></t-input>
        <t-button
          theme="primary"
          variant="outline"
          :disabled="smsCooldown > 0"
          @click="send_sms_code"
          class="sms-send-btn"
        >
          {{ smsCooldown > 0 ? t('smsLogin.sendCodeCooldown', { n: smsCooldown }) : t('smsLogin.sendCode') }}
        </t-button>
      </div>
      <div style="text-align: center;margin: 20px auto 10px;width: 70%;">
        <t-button theme="primary" variant="light" @click="login_with_sms" block>{{ t('smsLogin.login') }}</t-button>
      </div>
      <div style="text-align: center;font-size: small; color: grey;margin-top: 10px;">
        {{ t('messages.tokenStored') }}
      </div>
    </div>
  </div>

  <div v-if="has_tested">
    <div class="card">
      <div @click="toggleCard(1)">
        <p style="font-size: larger;font-weight: bold;text-align: center;"
          :style="{ color: isCollapsed1 ? '#c1c1c1' : '#333' }">{{ t('cards.userInfo.title') }}</p>
        <icon-font class="toggle-icon" :name="isCollapsed1 ? 'expand-down' : 'expand-up'"></icon-font>
      </div>
      <div class="card-content card-details" v-show="!isCollapsed1">
        <p>{{ t('cards.userInfo.nickname') }}：{{ account_info.nick_name }}</p>
        <p>{{ t('cards.userInfo.phone') }}：{{ account_info.phone }}</p>
        <p>{{ t('cards.userInfo.team') }}：{{ account_info.team_name }} - {{ account_info.name }}</p>
        <p>{{ t('cards.userInfo.rule') }}：{{ account_info.rule }}</p>
      </div>
    </div>
    <br>
    <div v-if="daka_config" class="card">
      <button type="button" class="icon-button edit-icon-button" @click.stop="openEditDialog">
        <edit-icon class="edit-icon" size="18px" />
      </button>
      <div @click="toggleCard(2)">
        <p style="font-size: larger; font-weight: bold; text-align: center;"
          :style="{ color: isCollapsed2 ? '#c1c1c1' : '#333' }">{{ t('cards.location.title') }}</p>
        <icon-font class="toggle-icon" :name="isCollapsed2 ? 'expand-down' : 'expand-up'"></icon-font>
      </div>
      <div class="card-content card-details" v-show="!isCollapsed2">
        <p>{{ t('cards.location.address') }}：{{ daka_config.address }}</p>
        <p>{{ t('cards.location.clockAddress') }}：{{ daka_config.location }}</p>
        <p>{{ t('cards.location.longitude') }}：{{ daka_config.longitude }} </p>
        <p>{{ t('cards.location.latitude') }}：{{ daka_config.latitude }} </p>
        <p>{{ t('cards.location.wifiName') }}：{{ daka_config.wifi }} </p>
        <p>{{ t('cards.location.wifiMac') }}：{{ daka_config.wifi_mac }} </p>
        <p>{{ t('cards.location.randomOffsetLabel') }}：{{ daka_config.randomOffset ?? DEFAULT_DAKA_CONFIG.randomOffset }} {{ t('cards.location.metersUnit') }}</p>
      </div>
    </div>

    <div v-if="showEditDialog" class="edit-dialog-backdrop" @click.self="showEditDialog = false">
      <div class="edit-dialog-panel">
        <div class="edit-dialog-header">
          <span class="edit-dialog-title">{{ t('cards.location.editDialogTitle') }}</span>
          <button type="button" class="icon-button edit-dialog-close-button" @click="showEditDialog = false">
            <close-icon class="edit-dialog-close" size="22px" />
          </button>
        </div>
        <div class="edit-dialog-body">
          <div class="edit-field">
            <label>{{ t('cards.location.address') }}</label>
            <t-input v-model="editForm.address" class="edit-input" />
          </div>
          <div class="edit-field">
            <label>{{ t('cards.location.clockAddress') }}</label>
            <t-input v-model="editForm.location" class="edit-input" />
          </div>
          <div class="edit-field">
            <label>{{ t('cards.location.longitude') }}</label>
            <t-input v-model="editForm.longitude" class="edit-input" :tips="editErrors.longitude" />
          </div>
          <div class="edit-field">
            <label>{{ t('cards.location.latitude') }}</label>
            <t-input v-model="editForm.latitude" class="edit-input" :tips="editErrors.latitude" />
          </div>
          <div class="edit-field">
            <label>{{ t('cards.location.wifiName') }}</label>
            <t-input v-model="editForm.wifi" class="edit-input" />
          </div>
          <div class="edit-field">
            <label>{{ t('cards.location.wifiMac') }}</label>
            <t-input v-model="editForm.wifi_mac" class="edit-input" :tips="editErrors.wifi_mac" />
          </div>
          <div class="edit-field">
            <label>{{ t('cards.location.randomOffsetLabel') }}（{{ t('cards.location.metersUnit') }}）</label>
            <t-input v-model="editForm.randomOffset" class="edit-input" :tips="editErrors.randomOffset" />
          </div>
        </div>
        <div class="edit-dialog-footer">
          <t-button variant="outline" theme="default" @click="resetConfigToDefault" style="flex: 1;">
            {{ t('cards.location.resetDefault') }}
          </t-button>
          <t-button theme="primary" @click="saveEditConfig" style="flex: 1;">
            {{ t('cards.location.save') }}
          </t-button>
        </div>
      </div>
    </div>

    <br>

    <div v-if="today_status">
      <p style="font-size: larger;font-weight: bold;text-align: center;margin: 1% auto 5px;">{{ t('cards.today.title') }}</p>
      <div class="card">
        <div v-if="account_info.is_rest_rule"
          style="text-align: center; color: blue; margin: 10px;">
          {{ t('cards.today.noCheckIn') }}
        </div>
        <div v-else>
          <p style="font-weight: bold;text-align: center;">{{ t('cards.today.currentTitle') }}</p>
          <div v-if="today_status.current">
            <div>
              <div v-for="(item, index) in today_status.current.details" :key="index" style="margin-left: 20px;">
                <p>{{ item.desc }}：{{ item.statusDesc }}
                <div v-if="item.currentTag" style="color: red;display: contents;">&nbsp;[当前打卡点]</div>
                </p>
              </div>
            </div>
          </div>
          <p style="font-weight: bold;text-align: center;margin-top: 10px;">{{ t('cards.today.otherTitle') }}</p>
          <div v-if="today_status.others">
            <div v-for="(shift, shiftIndex) in today_status.others" :key="shiftIndex" class="shift"
              style="margin-left: 20px;">
              <div>
                <div v-for="(item, index) in shift.details" :key="index">
                  <p>{{ item.desc }}：{{ item.statusDesc }}</p>
                </div>
              </div>
            </div>
          </div>
          <div style="width: 50%;text-align: center;margin: 0 auto;">
            <t-button theme="light" variant="outline" @click="refresh_today_status" block>{{ t('buttons.refresh') }}</t-button>
          </div>
        </div>
      </div>
      <br>

      <br>
      <div style="text-align: center;">
        <t-button
          theme="primary"
          @click="handleDakaClick"
          :disabled="isCheckingIn || cooldownRemaining > 0"
          :loading="isCheckingIn"
          style="font-size: 20px;letter-spacing: 3px;text-align: center;width: 70%;height: 60px;margin: 0 20px;box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);">
          {{ checkInButtonText }}
        </t-button>
      </div>
      <div style="text-align: center;font-size: small; color: grey;margin-top: 10px;">{{ t('hints.avoidRepeat') }}</div>
      <div style="text-align: center;font-size: small; color: grey;">{{ t('hints.learningOnly') }}</div>
    </div>
  </div>
  <t-divider />
  <div
    style="text-align: center;font-size: small; color: grey;display: flex;align-items: center;justify-content: center;margin-top: 30px;">
    <div>{{ t('settings.autoLogin') }}&nbsp;</div>
    <t-switch size="small" :default-value="true" :icon="icons" v-model="auto_login"
      @change="save_auto_login"></t-switch>
  </div>
  <p style="text-align: center;margin-top: 5px;">
    <a href="https://github.com/Little-King2022/HikIOT_signature" target="_blank">
      <img src="https://img.shields.io/badge/deploy_with-Vercel-%23000000?logo=vercel" alt="Deploy with Vercel">&nbsp;
      <img alt="GitHub" src="https://img.shields.io/badge/Github-%E9%A1%B9%E7%9B%AE%E5%9C%B0%E5%9D%80-blue">&nbsp;
      <img alt="GitHub stars"
        src="https://img.shields.io/github/stars/Little-King2022/HikIOT_signature.svg?style=social">
    </a>
  </p>
</template>

<style scoped>
.home-input {
  margin: 20px auto 10px;
  display: block;
  width: 90%;
  border: 1px solid rgba(220, 220, 220, 1);
  border-radius: 6px;
}

.card {
  margin: 0px 10px;
  background-color: rgba(232, 244, 255, 0.524);
  padding: 10px 20px;
  border-radius: 10px;
  --td-input-bg-color: aliceblue;
  --td-input-suffix-text-color: rgba(142, 142, 142, 0.5);
  --td-input-vertical-padding: 10px;
  border-radius: 8px;
  box-shadow: 6px 6px 8px rgba(0, 0, 0, 0.3);
  animation: fade-in 0.2s;
  position: relative;
  overflow: hidden;
  transition: height 1s ease;
}

.card-content {
  transition: max-height 0.3s ease-in-out;
}

.card-details {
  margin: 0 0 5px;
  text-align: left;
}

.toggle-icon {
  position: absolute;
  top: 12px;
  right: 10px;
  cursor: pointer;
  font-size: 20px;
  transition: transform 1s ease;
}

.card.collapsed .toggle-icon {
  transform: rotate(180deg);
}

.icon-button {
  border: 0;
  background: transparent;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.edit-icon {
  font-size: 18px;
  color: #666;
}

.edit-icon-button {
  position: absolute;
  top: 12px;
  right: 36px;
  z-index: 1;
}

.edit-dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.edit-dialog-panel {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.edit-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.edit-dialog-title {
  font-size: 16px;
  font-weight: bold;
}

.edit-dialog-close {
  color: #666;
}

.edit-dialog-close-button {
  flex-shrink: 0;
}

.edit-dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
}

.edit-field {
  margin-bottom: 12px;
}

.edit-field label {
  display: block;
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}

.edit-input {
  border: 1px solid rgba(220, 220, 220, 1);
  border-radius: 6px;
}

@media (prefers-color-scheme: dark) {
  .edit-dialog-backdrop {
    background: rgba(0, 0, 0, 0.7);
  }

  .edit-dialog-panel {
    background: #1f2937;
    color: #f3f4f6;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  }

  .edit-dialog-header {
    border-bottom-color: rgba(255, 255, 255, 0.12);
  }

  .edit-dialog-title,
  .edit-dialog-close,
  .edit-field label {
    color: #f3f4f6;
  }

  .edit-dialog-footer {
    border-top-color: rgba(255, 255, 255, 0.12);
  }

  .edit-icon {
    color: #d1d5db;
  }

  .edit-input {
    border-color: rgba(255, 255, 255, 0.12);
  }

  .edit-input :deep(.t-input) {
    background: #111827;
    color: #f9fafb;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .edit-input :deep(.t-input__inner),
  .edit-input :deep(.t-input__inner::placeholder),
  .edit-input :deep(.t-input__suffix),
  .edit-input :deep(.t-input__tips) {
    color: #d1d5db;
  }
}

.edit-dialog-footer {
  display: flex;
  padding: 12px 20px;
  border-top: 1px solid #eee;
  gap: 8px;
}

t-switch {
  height: 1px;
}

.login-tabs {
  display: flex;
  margin: 16px 5% 0;
  border-bottom: 2px solid #e5e7eb;
}

.login-tab-btn {
  flex: 1;
  padding: 10px 6px;
  font-size: 14px;
  font-weight: 500;
  background: transparent;
  border: none;
  border-bottom: 3px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  color: #9ca3af;
  transition: color 0.2s, border-color 0.2s;
}

.login-tab-btn.active {
  color: #0052d9;
  border-bottom-color: #0052d9;
}

.sms-login-container {
  padding-bottom: 10px;
}

.sms-code-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 5%;
}

.sms-code-input {
  flex: 1;
  border: 1px solid rgba(220, 220, 220, 1);
  border-radius: 6px;
}

.sms-send-btn {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 13px;
}

@media (prefers-color-scheme: dark) {
  .login-tabs {
    border-bottom-color: rgba(255, 255, 255, 0.12);
  }

  .login-tab-btn {
    color: #6b7280;
  }

  .login-tab-btn.active {
    color: #60a5fa;
    border-bottom-color: #60a5fa;
  }
}
</style>
