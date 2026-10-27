const number = value => Number(value).toLocaleString('ko-KR');
const dateTime = value => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date(value));

export function mountGrants({ auth, apiBase, fetcher = fetch, document: doc = document,
  confirm = message => window.confirm(message), now = Date.now }) {
  const $ = id => doc.getElementById(id);
  let user = null, generation = 0, snapshot = null, checkedAt = 0, busy = false, controller = null;
  function message(text, error = false) {
    $('grant-status').textContent = text;
    $('grant-status').classList.toggle('error', error);
  }
  function controls() {
    $('grant-preview').disabled = !user || busy;
    $('grant-execute').hidden = snapshot?.status !== 'pending';
    $('grant-execute').disabled = !user || busy || snapshot?.status !== 'pending';
  }
  function valid(data) {
    return data?.campaignId === 'member-two-token-gift-v1' && ['pending', 'completed'].includes(data.status) &&
      data.quantityPerMember === 2 && Number.isSafeInteger(data.price) && data.price > 0 &&
      Number.isSafeInteger(data.serverTime) && Number.isSafeInteger(data.quoteRevision) &&
      /^[a-f0-9]{64}$/.test(data.recipientKey) && Array.isArray(data.recipients) && data.recipients.length > 0 &&
      data.totalQuantity === data.recipients.length * 2 && data.recipients.every(r => typeof r.name === 'string' && r.quantity === 2) &&
      (data.status !== 'completed' || Number.isSafeInteger(data.executedAt));
  }
  function render(data) {
    if (!valid(data)) throw new Error('지급 응답을 확인할 수 없어요. 지급 대상을 다시 확인해주세요.');
    snapshot = data; checkedAt = now();
    $('grant-details').hidden = false;
    $('grant-count').textContent = number(data.recipients.length) + '명';
    $('grant-price').textContent = number(data.price) + ' P';
    $('grant-total').textContent = number(data.totalQuantity) + '토큰';
    const rows = data.recipients.map(recipient => {
      const row = doc.createElement('li'), name = doc.createElement('span'), quantity = doc.createElement('strong');
      name.textContent = recipient.name; quantity.textContent = '2토큰'; row.append(name, quantity); return row;
    });
    $('grant-recipients').replaceChildren(...rows);
    message(data.status === 'completed' ? '지급 완료 · ' + dateTime(data.executedAt) + ' · 중복 지급되지 않습니다.' :
      '지급 대상을 확인했어요. 실행 시 이 기준가가 적용되며 멤버의 포인트는 차감하지 않습니다.');
    controls();
  }
  async function request(body, turn, force = false) {
    const signal = controller.signal;
    const token = await auth.idToken(force);
    if (turn !== generation || signal.aborted) throw new DOMException('Account changed', 'AbortError');
    if (!token) throw new Error('Google 계정으로 로그인해주세요.');
    const response = await fetcher(apiBase.replace(/\/$/, '') + '/admin/grants', {
      method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', signal
    });
    if (response.status === 401 && !force) return request(body, turn, true);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '지급 서버에 연결하지 못했어요.');
    return data;
  }
  async function run(execute) {
    if (!user || busy || (execute && snapshot?.status !== 'pending')) return;
    const turn = generation, preview = snapshot;
    busy = true; controls();
    controller = new AbortController();
    const activeController = controller;
    let timer;
    try {
      if (execute) {
        if (now() - checkedAt > 60000) throw new Error('확인 시간이 지났어요. 지급 대상을 다시 확인해주세요.');
        const accepted = await confirm('전 멤버 ' + preview.recipients.length + '명에게 각각 2토큰을 지급할까요?\n' +
          '1토큰 기준가: ' + number(preview.price) + ' P\n총 ' + number(preview.totalQuantity) + '토큰 · 포인트 차감 없음\n이 지급은 한 번만 실행됩니다.');
        if (turn !== generation || !accepted) return;
        if (now() - checkedAt > 60000) throw new Error('확인 시간이 지났어요. 지급 대상을 다시 확인해주세요.');
      }
      timer = setTimeout(() => activeController.abort(), 15000);
      const body = execute ? { campaignId: preview.campaignId, expectedPrice: preview.price, expectedRevision: preview.quoteRevision,
        recipientKey: preview.recipientKey, expiresAt: preview.serverTime + 120000 } : undefined;
      const data = await request(body, turn);
      if (turn === generation) render(data);
    } catch (error) {
      if (turn !== generation) return;
      snapshot = null;
      $('grant-details').hidden = true;
      message((execute ? '지급 결과를 다시 확인해주세요. ' : '') +
        (error.name === 'AbortError' ? '서버 응답이 지연되고 있어요.' : error.message), true);
    } finally {
      clearTimeout(timer);
      if (turn === generation) { busy = false; controls(); }
    }
  }
  $('grant-preview').addEventListener('click', () => run(false));
  $('grant-execute').addEventListener('click', () => run(true));
  function setUser(next) {
    generation++; controller?.abort(); user = next; snapshot = null; busy = false;
    $('member-grants').hidden = !user; $('grant-details').hidden = true;
    $('grant-recipients').replaceChildren();
    message('대상과 현재 기준가를 먼저 확인해주세요. 확인만으로는 지급되지 않습니다.'); controls();
  }
  setUser(null);
  return { setUser };
}
