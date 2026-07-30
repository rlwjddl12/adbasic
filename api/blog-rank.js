// api/blog-rank.js
//
// 저장 위치: adbasic/api/blog-rank.js  (analyze-blog.js와 같은 폴더)
//
// 사용법: /api/blog-rank?url=블로그글URL&keyword=확인할키워드
//
// 동작 방식:
// 1. 입력한 블로그 글 URL에서 blogId, logNo를 추출합니다.
// 2. 네이버 블로그 검색(where=post) 결과 페이지를 최대 3페이지(최대 90개)까지 가져옵니다.
// 3. 결과 페이지 안의 blog.naver.com 링크들을 "나오는 순서 그대로" 훑어서
//    중복을 제거한 뒤, 내 글이 몇 번째로 나오는지 찾습니다.
//
// ⚠️ 참고: 특정 CSS class 이름에 의존하지 않고 "링크가 나오는 순서"만 보고 순위를 매기는
// 방식이라 네이버가 디자인을 바꿔도 비교적 잘 버티는 편이지만, 네이버 검색 결과 자체가
// 로그인 여부·개인화·지역에 따라 사람마다 다르게 보일 수 있어 100% 일치하지 않을 수 있습니다.
// 자동화된 요청을 네이버가 일시적으로 차단(429 등)할 수도 있습니다.
//
// 필요 패키지: cheerio (analyze-blog.js와 공용, package.json에 이미 추가되어 있으면 OK)

const cheerio = require('cheerio');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MAX_PAGES = 3; // 페이지당 30개 기준, 최대 90위까지 확인

function parseBlogUrl(url) {
  // blog.naver.com/{blogId}/{logNo} 또는 m.blog.naver.com/{blogId}/{logNo} 형태에서 추출
  const m = url.match(/blog\.naver\.com\/([^\/?]+)\/(\d+)/);
  if (!m) return null;
  return { blogId: m[1], logNo: m[2] };
}

async function fetchSearchPage(keyword, start) {
  const searchUrl =
    'https://search.naver.com/search.naver?where=post&sm=tab_jum&query=' +
    encodeURIComponent(keyword) +
    '&start=' + start;
  const res = await fetch(searchUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  if (!res.ok) throw new Error('네이버 검색 요청 실패: ' + res.status);
  return res.text();
}

function extractOrderedPosts(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const ordered = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/blog\.naver\.com\/([^\/?]+)\/(\d+)/);
    if (!m) return;
    const key = m[1] + '/' + m[2];
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ blogId: m[1], logNo: m[2] });
  });

  return ordered;
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
    let allPosts = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const start = page * 30 + 1;
      const html = await fetchSearchPage(keyword, start);
      const posts = extractOrderedPosts(html);
      if (posts.length === 0) break; // 더 이상 결과 없음
      allPosts = allPosts.concat(posts);
    }

    // 전체에서 중복 제거(페이지 간 겹칠 수 있음) 후 순서 유지
    const seen = new Set();
    const uniquePosts = [];
    for (const p of allPosts) {
      const key = p.blogId + '/' + p.logNo;
      if (seen.has(key)) continue;
      seen.add(key);
      uniquePosts.push(p);
    }

    const idx = uniquePosts.findIndex(
      (p) => p.blogId === target.blogId && p.logNo === target.logNo
    );

    if (idx === -1) {
      res.status(200).json({ found: false, checked: uniquePosts.length });
    } else {
      res.status(200).json({ found: true, rank: idx + 1, checked: uniquePosts.length });
    }
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
