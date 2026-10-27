import { config } from './config.js';
import { mountAdmin } from './controller.js?v=20261027-grants1';

try {
  const auth = await import('./auth.js');
  mountAdmin({ auth, apiBase: config.apiBase });
} catch (_) {
  const notice = document.getElementById('notice');
  notice.hidden = false;
  notice.classList.add('error');
  notice.textContent = '로그인 모듈을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해주세요.';
  document.getElementById('login').disabled = true;
}
