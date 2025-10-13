import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hopmmcjhbfmoqawokwdi.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY || 'your-supabase-anon-key'

export const supabase = createClient(supabaseUrl, supabaseKey)

// 缓存IP地址，当前会话有效
let cachedIP = null

// 记录用户信息到数据库
export const recordUserInfo = async (userInfo) => {
  try {
    // 先创建匿名用户身份，防止401报错
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously()
    
    if (authError) {
      // console.error('匿名登录失败:', authError)
      // 如果匿名登录失败，仍然尝试插入数据
    }

    // 获取用户IP和UA信息
    const ip = await getUserIP()
    const ua = navigator.userAgent

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
    //   console.error('记录用户信息失败:', error)
      return { success: false, error }
    }

    // console.log('用户信息记录成功', data)
    return { success: true, data }
  } catch (error) {
    // console.error('记录用户信息异常:', error)
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
    const response = await fetch('https://api.ip.sb/ip')
    const data = await response.text()

    // 缓存IP地址
    cachedIP = data.trim()
    // console.log('IP地址已缓存:', cachedIP)
    
    return cachedIP
  } catch (error) {
    // console.error('获取IP地址失败:', error)
    return 'unknown'
  }
}
