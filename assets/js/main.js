const copyButtonSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" class="bi bi-copy" viewBox="0 0 16 16">
  <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/>
</svg>`;

const checkmarkSVG = `Copied <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check-lg" viewBox="0 0 16 16">
  <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425z"/>
</svg>`;

// use a class selector if available
let blocks = document.querySelectorAll("pre");

blocks.forEach((block) => {
  // only add button if browser supports Clipboard API
  if (navigator.clipboard) {
    let button = document.createElement("button");
    button.innerHTML = copyButtonSVG;
    button.style.position = "absolute";
    button.style.top = "5px";
    button.style.right = "5px";
    block.style.position = "relative";
    block.appendChild(button);
    button.addEventListener("click", async () => {
      await copyCode(block, button);
    });
  }
});

async function copyCode(block, button) {
  let code = block.querySelector("code");
  let text = code.innerText;
  await navigator.clipboard.writeText(text);
  
  // visual feedback that task is completed
  button.innerHTML = checkmarkSVG; // Checkmark symbol
  button.style.backgroundColor = "green";
  button.style.color = "white";
  button.style.borderRadius = "4px";

  setTimeout(() => {
    button.innerHTML = copyButtonSVG;
    button.style.backgroundColor = "";
    button.style.color = "";
  }, 1000);
}

let mainNav = document.getElementById("js-menu");
let navBarToggle = document.getElementById("js-nav-toggle");

navBarToggle.addEventListener("click", function() {
  mainNav.classList.toggle("active");
});

// 이미지 모달 기능
document.addEventListener("DOMContentLoaded", function() {
  // 모든 콘텐츠 내 이미지에 클릭 이벤트 추가
  const content_images = document.querySelectorAll("#content img");
  
  // 모달 HTML 생성
  const modal = document.createElement("div");
  modal.className = "image-modal";
  modal.innerHTML = `
    <span class="close">&times;</span>
    <img src="" alt="">
  `;
  document.body.appendChild(modal);
  
  const modal_img = modal.querySelector("img");
  const close_btn = modal.querySelector(".close");
  
  // 각 이미지에 클릭 이벤트 추가
  content_images.forEach(img => {
    img.addEventListener("click", function() {
      modal.style.display = "block";
      modal_img.src = this.src;
      modal_img.alt = this.alt;
      document.body.style.overflow = "hidden"; // 스크롤 방지
    });
  });
  
  // 모달 닫기 기능
  function close_modal() {
    modal.style.display = "none";
    document.body.style.overflow = "auto"; // 스크롤 복원
  }
  
  // 닫기 버튼 클릭
  close_btn.addEventListener("click", close_modal);
  
  // 모달 배경 클릭
  modal.addEventListener("click", function(e) {
    if (e.target === modal) {
      close_modal();
    }
  });
  
  // ESC 키로 모달 닫기
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && modal.style.display === "block") {
      close_modal();
    }
  });
});

// 언어 토글 기능
document.addEventListener("DOMContentLoaded", function() {
  const lang_toggle = document.querySelector(".lang-toggle");
  if (!lang_toggle) return;

  const current_lang = lang_toggle.dataset.currentLang;
  const lang_ref = lang_toggle.dataset.langRef;
  const PREF_KEY = "langPref";

  // 저장된 언어 선호도가 현재 페이지와 다르면 자동 이동
  const stored_pref = localStorage.getItem(PREF_KEY);
  if (stored_pref && stored_pref !== current_lang && lang_ref) {
    window.location.href = lang_ref;
    return;
  }

  // 버튼 클릭 이벤트
  lang_toggle.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", function() {
      const target_lang = this.dataset.lang;
      localStorage.setItem(PREF_KEY, target_lang);
      if (target_lang !== current_lang && lang_ref) {
        window.location.href = lang_ref;
      }
    });
  });
});

// TOC (목차) 기능
document.addEventListener("DOMContentLoaded", function() {
  const content = document.getElementById("content");
  if (!content) return;

  // 헤딩 요소들 찾기
  const headings = content.querySelectorAll("h1, h2, h3, h4, h5, h6");
  if (headings.length === 0) return;

  // TOC 컨테이너 생성
  const toc_sidebar = document.createElement("div");
  toc_sidebar.className = "toc-sidebar";
  toc_sidebar.innerHTML = `
    <h3>Table of Contents</h3>
    <ul class="toc-list"></ul>
  `;
  document.body.appendChild(toc_sidebar);

  // TOC 토글 버튼 생성
  const toc_toggle = document.createElement("button");
  toc_toggle.className = "toc-toggle";
  toc_toggle.innerHTML = "📋";
  toc_toggle.title = "Table of Contents";
  document.body.appendChild(toc_toggle);

  const toc_list = toc_sidebar.querySelector(".toc-list");
  let toc_visible = false;

  // 헤딩에 ID 추가 및 TOC 항목 생성
  headings.forEach((heading, index) => {
    // 헤딩에 고유 ID 추가
    if (!heading.id) {
      const heading_text = heading.textContent.trim();
      const heading_id = `heading-${index}-${heading_text.toLowerCase()
        .replace(/[^a-z0-9가-힣]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')}`;
      heading.id = heading_id;
    }

    // TOC 항목 생성
    const toc_item = document.createElement("li");
    const toc_link = document.createElement("a");
    toc_link.href = `#${heading.id}`;
    toc_link.textContent = heading.textContent.trim();
    toc_link.className = `toc-${heading.tagName.toLowerCase()}`;
    
    toc_item.appendChild(toc_link);
    toc_list.appendChild(toc_item);

    // 클릭 이벤트 추가
    toc_link.addEventListener("click", function(e) {
      e.preventDefault();
      const target = document.getElementById(heading.id);
      if (target) {
        const offset_top = target.offsetTop - 100; // 헤더 높이 고려
        window.scrollTo({
          top: offset_top,
          behavior: "smooth"
        });
        
        // 활성 상태 업데이트
        update_active_toc(toc_link);
      }
    });
  });

  // TOC 토글 기능
  toc_toggle.addEventListener("click", function() {
    toc_visible = !toc_visible;
    if (toc_visible) {
      toc_sidebar.classList.add("visible");
      toc_toggle.innerHTML = "✖️";
    } else {
      toc_sidebar.classList.remove("visible");
      toc_toggle.innerHTML = "📋";
    }
  });

  // 스크롤 시 활성 헤딩 추적
  function update_active_toc(active_link) {
    // 모든 TOC 링크에서 active 클래스 제거
    const all_toc_links = toc_list.querySelectorAll("a");
    all_toc_links.forEach(link => link.classList.remove("active"));
    
    // 현재 링크에 active 클래스 추가
    if (active_link) {
      active_link.classList.add("active");
    }
  }

  // 스크롤 이벤트로 현재 섹션 하이라이트
  let scroll_timeout;
  window.addEventListener("scroll", function() {
    clearTimeout(scroll_timeout);
    scroll_timeout = setTimeout(() => {
      const scroll_pos = window.scrollY + 150;
      let current_heading = null;

      headings.forEach(heading => {
        if (heading.offsetTop <= scroll_pos) {
          current_heading = heading;
        }
      });

      if (current_heading) {
        const current_link = toc_list.querySelector(`a[href="#${current_heading.id}"]`);
        update_active_toc(current_link);
      }
    }, 100);
  });

  // 초기 활성 상태 설정
  if (headings.length > 0) {
    const first_link = toc_list.querySelector("a");
    update_active_toc(first_link);
  }
});