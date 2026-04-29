import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hopmmcjhbfmoqawokwdi.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY || 'your-supabase-anon-key'

export const supabase = createClient(supabaseUrl, supabaseKey)

let authInitPromise = null
let cachedSession = null

export const initSupabaseAuth = async () => {
  if (cachedSession) {
    return cachedSession
  }

  if (!authInitPromise) {
    authInitPromise = (async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession()

      if (session) {
        cachedSession = session
        return cachedSession
      }

      const { data, error } = await supabase.auth.signInAnonymously()

      if (error) {
        throw error
      }

      cachedSession = data?.session ?? null
      return cachedSession
    })()
  }

  try {
    return await authInitPromise
  } catch (error) {
    authInitPromise = null
    throw error
  }
}

// 缓存IP地址，当前会话有效
let cachedIP = null

// 记录用户信息到数据库（仅在 VITE_ENABLE_SUPABASE_LOG 为 true 时生效）
export const recordUserInfo = async (userInfo) => {
  if (import.meta.env.VITE_ENABLE_SUPABASE_LOG !== 'true') {
    return { success: false, error: 'supabase logging disabled' }
  }
  try {
    const ip = await getUserIP()

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'

    const { data, error } = await supabase
      .from('user')
      .insert([
        {
          nick_name: userInfo.nick_name,
          name: userInfo.name,
          daka_result: userInfo.daka_result || null,
          ip: ip,
          ua: ua,
          phone: userInfo.phone,
          team_name: userInfo.team_name
        }
      ])

    if (error) {
      // console.error('记录用户信息失败:', error)
      return { success: false, error }
    }

    // console.log('用户信息记录成功', data)
    return { success: true, data }
  } catch (error) {
    // console.error('记录用户信息异常:', error)
    return { success: false, error }
  }
}

export const getDakaSettings = async (accountNo) => {
  if (!accountNo || supabaseKey === 'your-supabase-anon-key') {
    return { success: false, error: 'supabase settings disabled' }
  }

  try {
    await initSupabaseAuth()

    const { data, error } = await supabase
      .from('daka_settings')
      .select('schedule_config,daka_config,updated_at')
      .eq('account_no', accountNo)
      .maybeSingle()

    if (error) {
      return { success: false, error }
    }

    return { success: true, data }
  } catch (error) {
    return { success: false, error }
  }
}

export const saveDakaSettings = async (accountNo, settings) => {
  if (!accountNo || supabaseKey === 'your-supabase-anon-key') {
    return { success: false, error: 'supabase settings disabled' }
  }

  try {
    await initSupabaseAuth()

    const { data, error } = await supabase
      .from('daka_settings')
      .upsert({
        account_no: accountNo,
        schedule_config: settings.schedule_config ?? {},
        daka_config: settings.daka_config ?? {},
        updated_at: new Date().toISOString()
      }, { onConflict: 'account_no' })
      .select()
      .single()

    if (error) {
      return { success: false, error }
    }

    return { success: true, data }
  } catch (error) {
    return { success: false, error }
  }
}

// 获取用户IP地址（带缓存）
const getUserIP = async () => {
  try {
    // 如果已有缓存的IP，直接返回
    if (cachedIP) {
    //   console.log('使用缓存的IP地址:', cachedIP)
      return cachedIP
    }

    // console.log('正在获取IP地址...')
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    try {
      const response = await fetch('https://api.ip.sb/ip', { signal: controller.signal })
      const data = await response.text()

      // 缓存IP地址
      cachedIP = data.trim()
      // console.log('IP地址已缓存:', cachedIP)

      return cachedIP
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    // console.error('获取IP地址失败:', error)
    return 'unknown'
  }
}
