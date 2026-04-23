// ===== URGENCY BADGES =====
// Adds "Only X spots left" and time-based urgency to tour cards

document.addEventListener('DOMContentLoaded', () => {
    const tourCards = document.querySelectorAll('.tour-card');
    
    tourCards.forEach((card, index) => {
        // Simulate availability (in real app, would be real-time data)
        const spotsLeft = Math.floor(Math.random() * 5) + 1; // 1-5 spots
        const hour = new Date().getHours();
        const isEveningPeak = hour >= 16 && hour <= 19; // 4PM-7PM peak booking
        
        // Create urgency badge
        const badge = document.createElement('div');
        badge.className = 'urgency-badge';
        
        let badgeText = '';
        let badgeColor = '';
        
        if (spotsLeft <= 2) {
            badgeText = `⏰ Only ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`;
            badgeColor = '#e74c3c'; // Red - high urgency
        } else if (spotsLeft <= 4 && isEveningPeak) {
            badgeText = `🔥 ${spotsLeft} spots left`;
            badgeColor = '#f39c12'; // Orange - medium urgency
        } else if (isEveningPeak) {
            badgeText = '🔥 Popular tour';
            badgeColor = '#f39c12';
        } else {
            badgeText = '✅ Availability confirmed';
            badgeColor = '#27ae60'; // Green - available
        }
        
        badge.style.cssText = `
            background: ${badgeColor};
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            margin-top: 10px;
            display: inline-block;
            animation: pulse 2s infinite;
        `;
        
        badge.textContent = badgeText;
        
        // Insert after price or before CTA
        const priceEl = card.querySelector('.tour-price');
        if (priceEl) {
            priceEl.parentNode.insertBefore(badge, priceEl.nextSibling);
        } else {
            card.querySelector('.tour-card-content')?.appendChild(badge);
        }
    });
});

// Add pulse animation for high-urgency badges
const style = document.createElement('style');
style.textContent = `
    .urgency-badge[style*="#e74c3c"] {
        animation: pulse-red 2s infinite;
    }
    
    @keyframes pulse {
        0%, 100% {
            opacity: 1;
        }
        50% {
            opacity: 0.85;
        }
    }
    
    @keyframes pulse-red {
        0%, 100% {
            opacity: 1;
            box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.7);
        }
        50% {
            box-shadow: 0 0 0 10px rgba(231, 76, 60, 0);
        }
    }
`;
document.head.appendChild(style);
