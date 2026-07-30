// api/blog-rank.js
//
// 저장 위치: adbasic/api/blog-rank.js  (analyze-blog.js와 같은 폴더)
// 사용법: /api/blog-rank?url=블로그글URL&keyword=확인할키워드
//
// ── 왜 이렇게 만들었는지 ──
// 실제 네이버 블로그 검색 결과 페이지의 소스를 직접 확인해보니, 결과 목록은
// <a href> 태그로 바로 나오는 게 아니라 <script> 안에 통째로 JSON 데이터로 심어져 있고,
// 그 데이터를 브라우저의 자바스크립트(entry.bootstrap(...))가 나중에 화면에 그려 넣는 방식이었습니다.
// 그래서 이 함수는 그 JSON을 직접 파싱해서 각 게시물의 순위(r 값)와 링크를 추출합니다.
// 이 방식은 이전의 "링크 등장 순서" 방식보다 훨씬 정확합니다.
//
// ── 알아두어야 할 제약 ──
// 1) "인기글"처럼 광고(파워링크성)로 붙는 슬롯은 실제 블로그 링크가 암호화된 리다이렉트 주소로만
//    나오기 때문에, 그 자리에 어떤 블로그가 들어있는지는 저희 쪽에서 알아낼 방법이 없습니다.
//    즉, 내 글이 "광고" 형태로 노출되고 있다면 이 도구로는 확인이 안 됩니다.
// 2) 네이버는 첫 화면 로딩 시 보통 30~35개 정도의 결과를 한 번에 내려줍니다. 그 이후(스크롤 시 추가 로딩되는
//    부분)는 별도의 서명된 요청 방식이라 안정적으로 재현하기 어려워, 이 도구는 "최초 노출되는 상위 목록"까지만 확인합니다.
// 3) 네이버가 화면 구조(JSON 스키마)를 바꾸면 이 파서도 다시 손봐야 할 수 있습니다.
//
// 필요 패키지: 없음 (표준 fetch만 사용, cheerio 불필요)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function parseBlogUrl(url) {
  const m = url.match(/blog\.naver\.com\/([^\/?]+)\/(\d+)/);
  if (!m) return null;
  return { blogId: m[1], logNo: m[2] };
}

function extractBalancedObject(text, startIdx) {
  let depth = 0;
  let inString = false;
  let strChar = '';
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') { i++; continue; } // 이스케이프된 문자는 건너뜀
      if (c === strChar) inString = false;
      continue;
    } else {
      if (c === '"' || c === "'") { inString = true; strChar = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return text.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

function extractBootstrapJson(html) {
  const marker = 'entry.bootstrap(document.getElementById(';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const closeParenIdx = html.indexOf(')', idx + marker.length);
  if (closeParenIdx === -1) return null;
  const objStartIdx = html.indexOf('{', closeParenIdx);
  if (objStartIdx === -1) return null;
  const objText = extractBalancedObject(html, objStartIdx);
  if (!objText) return null;
  try {
    return JSON.parse(objText);
  } catch (e) {
    return null;
  }
}

function walkForItems(obj, results) {
  if (Array.isArray(obj)) {
    obj.forEach((o) => walkForItems(o, results));
    return;
  }
  if (obj && typeof obj === 'object') {
    if (obj.templateId === 'ugcItem' && obj.props) {
      const props = obj.props;
      const rank =
        props.clickLog && props.clickLog.title && typeof props.clickLog.title.r === 'number'
          ? props.clickLog.title.r
          : null;
      const isAd = props.sourceProfile ? !!props.sourceProfile.isAdType : false;

      let url = null;
      if (props.keep && props.keep.keepTriggerUrl && props.keep.keepTriggerUrl.includes('blog.naver.com')) {
        url = props.keep.keepTriggerUrl;
      } else if (
        props.sourceProfile &&
        props.sourceProfile.titleHref &&
        props.sourceProfile.titleHref.includes('blog.naver.com')
      ) {
        url = props.sourceProfile.titleHref;
      } else if (props.titleHref && props.titleHref.includes('blog.naver.com')) {
        url = props.titleHref;
      }

      results.push({ rank, isAd, url });
    }
    for (const k in obj) walkForItems(obj[k], results);
  }
}

async function fetchSearchPage(keyword) {
  const searchUrl =
    'https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=' + encodeURIComponent(keyword);
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
  });
  if (!res.ok) throw new Error('네이버 검색 요청 실패: ' + res.status);
  return res.text();
}

module.exports = async (req, res) => {
  const { url, keyword } = req.query;

  if (!url || !keyword) {
    res.status(400).json({ error: 'url과 keyword 파라미터가 모두 필요합니다.' });
    return;
  }

  const target = parseBlogUrl(url);
  if (!target) {
    res.status(400).json({ error: 'blog.naver.com 형태의 링크가 아닙니다.' });
    return;
  }

  try {
    const html = await fetchSearchPage(keyword);
    const data = extractBootstrapJson(html);

    if (!data) {
      res.status(422).json({
        error:
          '검색 결과 데이터를 읽어오지 못했습니다. 네이버가 화면 구조를 바꿨거나, 일시적으로 요청이 차단됐을 수 있습니다.',
      });
      return;
    }

    const items = [];
    walkForItems(data, items);

    if (items.length === 0) {
      res.status(422).json({ error: '검색 결과 항목을 찾지 못했습니다.' });
      return;
    }

    const match = items.find((item) => {
      if (!item.url) return false;
      const parsed = parseBlogUrl(item.url);
      return parsed && parsed.blogId === target.blogId && parsed.logNo === target.logNo;
    });

    if (match) {
      res.status(200).json({ found: true, rank: match.rank, checked: items.length });
    } else {
      const adSlots = items.filter((i) => i.isAd).length;
      res.status(200).json({
        found: false,
        checked: items.length,
        adSlots,
      });
    }
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
