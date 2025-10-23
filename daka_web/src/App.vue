<script setup>
import { ref, h, computed, onBeforeUnmount } from 'vue';
import { Toast, Dialog } from 'tdesign-mobile-vue';
import axios from 'axios';
import md5 from './utils/md5';
import { IconFont, CloseIcon, CheckIcon } from 'tdesign-icons-vue-next';
import { recordUserInfo } from './utils/supabase';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const API_BASE = 'https://api.hikiot.com';
const FIXED_SIGN_SALT = 'WE1mfER7artAoJEwXKaCjw==';
const REST_KEYWORD = '休息';
const DEFAULT_DAKA_CONFIG = {
  message: 'success',
  location: '南京农业大学(滨江校区)农学院',
  address: '江苏省南京市浦口区江浦街道',
  longitude: 118.636838,
  latitude: 32.011898,
  wifi: 'NJAU',
  device_name: '微信小程序',
  wifi_mac: '58:ae:a8:32:59:90',
};

const icons = [h(CheckIcon, { size: '20px' }), h(CloseIcon, { size: '20px' })];

const overlay_visible = ref(false);
const token = ref('');
const auto_login = ref(false);
const has_verified = ref(false);
const has_tested = ref(false);
const account_info = ref({ is_rest_rule: false });
const today_status = ref({});
const daka_config = ref(DEFAULT_DAKA_CONFIG);
const errorMessage = ref('');
const isCheckingIn = ref(false);
const cooldownRemaining = ref(0);
let cooldownTimer = null;

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
    const { newLatitude, newLongitude } = addRandomOffset(DEFAULT_DAKA_CONFIG.latitude, DEFAULT_DAKA_CONFIG.longitude);
    const payload = {
      deviceSerial: '',
      longitude: newLongitude,
      latitude: newLatitude,
      clockSite: '江苏省南京市浦口区江浦街道南京农业大学(滨江校区)',
      address: DEFAULT_DAKA_CONFIG.address,
      deviceName: DEFAULT_DAKA_CONFIG.device_name,
      wifiName: DEFAULT_DAKA_CONFIG.wifi,
      wifiMac: DEFAULT_DAKA_CONFIG.wifi_mac,
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
  daka_config.value = DEFAULT_DAKA_CONFIG;
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

  <div v-if="has_tested">
    <div class="card">
      <div @click="toggleCard(1)">
        <p style="font-size: larger;font-weight: bold;text-align: center;"
          :style="{ color: isCollapsed1 ? '#c1c1c1' : '#333' }">{{ t('cards.userInfo.title') }}</p>
        <icon-font class="toggle-icon" :name="isCollapsed1 ? 'expand-down' : 'expand-up'"></icon-font>
      </div>
      <div class="card-content" style="margin: 0 auto 5px;" v-show="!isCollapsed1">
        <p>{{ t('cards.userInfo.nickname') }}：{{ account_info.nick_name }}</p>
        <p>{{ t('cards.userInfo.phone') }}：{{ account_info.phone }}</p>
        <p>{{ t('cards.userInfo.team') }}：{{ account_info.team_name }} - {{ account_info.name }}</p>
        <p>{{ t('cards.userInfo.rule') }}：{{ account_info.rule }}</p>
      </div>
    </div>
    <br>
    <div v-if="daka_config" class="card">
      <div @click="toggleCard(2)">
        <p style="font-size: larger; font-weight: bold; text-align: center;"
          :style="{ color: isCollapsed2 ? '#c1c1c1' : '#333' }">{{ t('cards.location.title') }}</p>
        <icon-font class="toggle-icon" :name="isCollapsed2 ? 'expand-down' : 'expand-up'"></icon-font>
      </div>
      <div class="card-content" style="margin-left: 20px;" v-show="!isCollapsed2">
        <p>{{ t('cards.location.address') }}：{{ daka_config.address }}</p>
        <p>{{ t('cards.location.clockAddress') }}：{{ daka_config.location }}</p>
        <p>{{ t('cards.location.longitude') }}：{{ daka_config.longitude }} </p>
        <p>{{ t('cards.location.latitude') }}：{{ daka_config.latitude }} </p>
        <p>{{ t('cards.location.wifiName') }}：{{ daka_config.wifi }} </p>
        <p>{{ t('cards.location.wifiMac') }}：{{ daka_config.wifi_mac }} </p>
        <p>{{ t('cards.location.randomOffset') }}</p>
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

t-switch {
  height: 1px;
}
</style>
