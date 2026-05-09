document.addEventListener('DOMContentLoaded', () => {
    const characterCards = document.querySelectorAll('.character-card');
    characterCards.forEach(card => {
        card.addEventListener('click', () => {
            const info = card.querySelector('.info');
            const lastP = info.lastElementChild;
            if (!lastP || !lastP.textContent.includes('角色模拟器')) {
                const tip = document.createElement('p');
                tip.style.marginTop = '8px';
                tip.style.color = '#e67e22';
                tip.textContent = '✨ 点击前往角色模拟器，查看详细技能演示';
                info.appendChild(tip);
            }
        });
    });
});
