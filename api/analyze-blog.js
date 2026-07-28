// api/analyze-blog.js
//
// 저장 위치: 저장소 최상위에 "api" 폴더를 만들고 그 안에 이 파일을 넣으세요.
//   adbasic/
//     ├─ index.html
//     └─ api/
//         └─ analyze-blog.js   ← 이 파일
//
// index.html은 Next.js 없이 순수 HTML/JS 정적 파일이므로, Next.js 전용 app/api 라우트가 아니라
// Vercel이 정적 프로젝트에서도 지원하는 "서버리스 함수"(api/*.js) 형태로 작성했습니다.
// 별도 설정 없이 이 파일만 올리고 배포하면 https://내도메인/api/analyze-blog 로 자동 인식됩니다.
//
// 필요 패키지: package.json이 없다면 저장소 최상위에 아래 내용으로 하나 만들어주세요.
//   {
//     "dependencies": { "cheerio": "^1.0.0" }
//   }
// (package.json이 이미 있다면 dependencies에 "cheerio": "^1.0.0" 한 줄만 추가)

const cheerio = require('cheerio');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('fetch failed: ' + res.status);
  return res.text();
}

function extractPostViewUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  const frameSrc = $('#mainFrame').attr('src');
  if (!frameSrc) return null;
  return new URL(frameSrc, baseUrl).toString();
}

function extractBodyText(html) {
  const $ = cheerio.load(html);
  let container = $('.se-main-container'); // 신버전 스마트에디터
  if (container.length === 0) container = $('#postViewArea'); // 구버전 에디터
  if (container.length === 0) return null;

  container.find('script, style').remove();
  return container
    .text()
    .replace(/\u200b/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = async (req, res) => {
  const url = req.query.url;

  if (!url || !url.includes('blog.naver.com')) {
    res.status(400).json({ error: 'blog.naver.com 링크만 지원합니다.' });
    return;
  }

  try {
    let html = await fetchHtml(url);
    let text = extractBodyText(html);

    if (!text) {
      const postViewUrl = extractPostViewUrl(html, url);
      if (postViewUrl) {
        html = await fetchHtml(postViewUrl);
        text = extractBodyText(html);
      }
    }

    if (!text) {
      res.status(422).json({ error: '본문을 찾을 수 없습니다. 비공개 글이거나 구조가 다른 페이지일 수 있습니다.' });
      return;
    }

    res.status(200).json({ text, length: text.length });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
