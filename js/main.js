document.addEventListener('DOMContentLoaded', () => {
    const codeElements = document.querySelectorAll('.code');
    codeElements.forEach(code => {
        code.addEventListener('click', () => {
            if (code.classList.contains('expired')) {
                alert('该兑换码已失效，无需复制');
                return;
            }
            navigator.clipboard.writeText(code.textContent.trim())
                .then(() => {
                    const originalText = code.textContent.trim();
                    code.textContent = '✅ 已复制！';
                    setTimeout(() => {
                        code.textContent = originalText;
                    }, 1500);
                })
                .catch(err => {
                    alert('复制失败，请手动复制：' + code.textContent.trim());
                });
        });
    });

    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-main a');
    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPath.split('/').pop()) {
            link.classList.add('active');
        }
    });

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
});
