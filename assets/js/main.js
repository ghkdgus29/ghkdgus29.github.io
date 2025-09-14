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