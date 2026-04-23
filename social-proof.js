// ===== SOCIAL PROOF NOTIFICATIONS =====
// Shows random "X just booked Y tour" notifications

const bookingNames = [
    'Sarah from Miami', 'Mike from Tampa', 'Jennifer from Atlanta',
    'David from Charlotte', 'Lisa from Nashville', 'Chris from New York',
    'Amanda from Boston', 'Brian from Dallas', 'Emily from Denver',
    'Kevin from Austin', 'Rachel from Seattle', 'Jason from Phoenix',
    'Michelle from Philadelphia', 'Ryan from San Francisco', 'Stephanie from Portland'
];

const tourNames = [
    'sunset cruise', 'snorkel tour', 'dolphin watching',
    'private boat charter', 'sandbar tour', 'fishing charter',
    'tiki boat crawl', 'jet ski rental', 'parasailing trip',
    'backcountry tour', 'Key West adventure', 'dry tortugas day trip'
];

function showSocialProof() {
    const name = bookingNames[Math.floor(Math.random() * bookingNames.length)];
    const tour = tourNames[Math.floor(Math.random() * tourNames.length)];
    
    const notification = document.createElement('div');
    notification.className = 'social-proof-notification';
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 20px;">✅</span>
            <span><strong>${name}</strong> just booked a ${tour}!</span>
        </div>
    `;
    
    notification.style.cssText = `
        position: fixed;
        bottom: 70px;
        right: 15px;
        background: white;
        border: 2px solid #2ecc71;
        border-radius: 8px;
        padding: 12px 16px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 998;
        max-width: 300px;
        font-size: 13px;
        animation: slideInRight 300ms ease-out;
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 300ms ease-in';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Add animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Show notification every 30-45 seconds
document.addEventListener('DOMContentLoaded', () => {
    setInterval(() => {
        showSocialProof();
    }, 30000 + Math.random() * 15000); // 30-45 seconds
    
    // Show first one after 5 seconds
    setTimeout(showSocialProof, 5000);
});
