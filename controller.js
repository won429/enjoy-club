const number = value => Number(value).toLocaleString('ko-KR');
const won = value => number(value / 100) + '원';
const dateTime = (value, dateOnly = false) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  ...(dateOnly ? { weekday: 'short' } : { hour: '2-digit', minute: '2-digit', hour12: false })
}).format(new Date(value));
const change = (price, baseline) => ({ amount: price - baseline, percent: (price - baseline) / baseline * 100 });
const signed = value => (value > 0 ? '+' : '') + number(value);
const changeText = (price, baseline) => {
  const value = change(price, baseline);
  return signed(value.amount) + ' P (' + (value.percent > 0 ? '+' : '') + value.percent.toFixed(2) + '%)';
};
const trend = (element, value) => { element.classList.toggle('up', value > 0); element.classList.toggle('down', value < 0); };

export function mountAdmin({ auth, apiBase, fetcher = fetch, document: doc = document }) {
  const $ = id => doc.getElementById(id);
  let user = null, snapshot = null, busy = false, generation = 0, pendingWrite = null, overviewController = null;
  $('today').textContent = dateTime(Date.now(), true);
  function notice(text, error = false) {
    $('notice').textContent = text;
    $('notice').hidden = !text;
    $('notice').classList.toggle('error', error);
  }
  function controls(enabled) {
    for (const id of ['index-price', 'index-note', 'save', 'refresh']) $(id).disabled = !enabled || busy;
  }
  function clearAdmin() {
    snapshot = null;
    pendingWrite = null;
    $('admin-content').hidden = true;
    $('change-history').hidden = true;
    $('login-panel').hidden = false;
    $('index-form').reset();
    $('history-body').replaceChildren();
    controls(false);
  }
  async function request(path, { body, signal, authorized = true, retry = true } = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 12000);
    try {
      const headers = {};
      if (authorized) {
        const token = await auth.idToken(false);
        if (!token) throw new Error('Google 계정으로 로그인해주세요.');
        headers.Authorization = 'Bearer ' + token;
      }
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetcher(apiBase.replace(/\/$/, '') + path, {
        method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store', credentials: 'omit', signal: controller.signal
      });
      if (authorized && response.status === 401 && retry) {
        await auth.idToken(true);
        return request(path, { body, signal, authorized, retry: false });
      }
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || '서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.');
        error.status = response.status;
        throw error;
      }
      return data;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  function renderMarket(market) {
    for (const [key, symbol] of [['index', 'enjoy'], ['stock', 'en-joy']]) {
      const quote = market.quotes.find(item => item.id === symbol);
      if (!quote || !Number.isSafeInteger(quote.price) || !Number.isFinite(quote.percent)) throw new Error('시세 응답을 확인할 수 없어요.');
      const unit = doc.createElement('span'); unit.textContent = 'P';
      $(key + '-value').replaceChildren(doc.createTextNode(number(quote.price) + ' '), unit);
      $(key + '-won').textContent = won(quote.price);
      $(key + '-change').textContent = (key === 'index' ? '전일 대비 ' : '직전 대비 ') + signed(quote.percent) + '%';
      trend($(key + '-change'), quote.change);
    }
  }
  function preview() {
    const value = Number($('index-price').value);
    const valid = Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000_000;
    $('price-won').textContent = valid ? '= ' + won(value) : '= —원';
    $('change-preview').textContent = valid && snapshot ? changeText(value, snapshot.baseline) : '—';
    trend($('change-preview'), valid && snapshot ? value - snapshot.baseline : 0);
  }
  function render(data, resetDraft = false) {
    if (!data?.market || !Number.isSafeInteger(data.market.revision) || !Number.isSafeInteger(data.baseline) || data.baseline < 1 || !Array.isArray(data.history)) throw new Error('관리자 응답을 확인할 수 없어요.');
    snapshot = data;
    renderMarket(data.market);
    $('login-panel').hidden = true;
    $('admin-content').hidden = false;
    $('change-history').hidden = false;
    $('stock-range').textContent = '±' + number(data.maxHourlyBps / 100) + '%';
    $('last-update').textContent = data.market.indexUpdatedAt ? '마지막 설정 ' + dateTime(data.market.indexUpdatedAt) : '마지막 설정 기록 없음';
    $('sync-status').textContent = data.market.stale ? '정각 시세 갱신 대기 중' : '서버 연결됨 · ' + dateTime(data.market.serverTime);
    if (resetDraft || !$('index-price').value) $('index-price').value = data.market.quotes.find(item => item.id === 'enjoy').price;
    const fragment = doc.createDocumentFragment();
    for (const entry of data.history) {
      const row = doc.createElement('tr');
      for (const [index, text] of [dateTime(entry.changedAt), number(entry.beforePoints) + ' P', number(entry.afterPoints) + ' P', changeText(entry.afterPoints, entry.baselinePoints), entry.note || '—'].entries()) {
        const cell = doc.createElement('td'); cell.textContent = text;
        if (index === 3) trend(cell, entry.afterPoints - entry.baselinePoints);
        row.append(cell);
      }
      fragment.append(row);
    }
    $('history-body').replaceChildren(fragment);
    $('empty-history').hidden = data.history.length > 0;
    preview();
    controls(true);
  }
  async function refresh(resetDraft = false) {
    const turn = generation;
    overviewController?.abort();
    overviewController = new AbortController();
    try {
      const data = await request('/admin/overview', { signal: overviewController.signal });
      if (turn !== generation) return;
      render(data, resetDraft);
      notice('');
    } catch (error) {
      if (turn !== generation || error.name === 'AbortError') return;
      if (error.status === 403 || error.status === 401) clearAdmin();
      notice(error.message, true);
    }
  }
  $('login').addEventListener('click', async () => {
    $('login').disabled = true;
    try { await auth.login(); } catch (error) {
      const messages = {
        'auth/unauthorized-domain': '이 사이트 주소의 로그인이 아직 허용되지 않았어요. Firebase Authentication의 승인된 도메인에 현재 도메인을 추가해주세요.',
        'auth/popup-blocked': '로그인 팝업이 차단됐어요. 이 사이트의 팝업을 허용하고 다시 눌러주세요.',
        'auth/popup-closed-by-user': '로그인 창을 닫았어요. 다시 로그인할 수 있어요.'
      };
      notice(messages[error.code] || 'Google 로그인에 실패했어요. 잠시 후 다시 시도해주세요.', true);
    } finally { $('login').disabled = false; }
  });
  $('logout').addEventListener('click', async () => { try { await auth.logout(); } catch (_) { notice('로그아웃을 완료하지 못했어요. 다시 눌러주세요.', true); } });
  $('refresh').addEventListener('click', () => { if (!busy) refresh(false); });
  for (const id of ['index-price', 'index-note']) $(id).addEventListener('input', () => { pendingWrite = null; preview(); });
  $('index-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!user || !snapshot || busy || !$('index-form').reportValidity()) return;
    const price = Number($('index-price').value);
    if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000_000) { notice('지수는 1~1,000,000,000 사이의 정수 포인트로 입력해주세요.', true); return; }
    const turn = generation;
    pendingWrite ||= { price, note: $('index-note').value.trim(), expectedRevision: snapshot.market.revision, requestId: crypto.randomUUID() };
    busy = true; controls(false); $('save').textContent = '저장 중…';
    try {
      const data = await request('/admin/index', { body: pendingWrite });
      if (turn !== generation) return;
      render(data, true);
      pendingWrite = null;
      $('index-note').value = '';
      notice('엔조이 지수를 ' + number(price) + 'P로 저장했어요. 다음 설정까지 이 값이 유지됩니다.');
    } catch (error) {
      if (turn !== generation) return;
      if (error.status && error.status < 500) pendingWrite = null;
      if (error.status === 401 || error.status === 403) clearAdmin();
      notice(error.name === 'AbortError' ? '저장 결과를 확인하지 못했어요. 다시 저장하면 같은 요청으로 결과를 확인합니다.' : error.message, true);
    } finally {
      busy = false;
      $('save').textContent = '지수 저장 ↗';
      controls(!!snapshot && !!user);
    }
  });
  clearAdmin();
  request('/market', { authorized: false }).then(data => { if (!snapshot && !user) renderMarket(data); }).catch(() => {});
  auth.observeAuth(next => {
    generation++;
    overviewController?.abort();
    user = next;
    clearAdmin();
    $('account-name').textContent = user?.email || '로그인 필요';
    $('logout').hidden = !user;
    notice('');
    if (user) refresh(true);
  });
  return { refresh };
}
