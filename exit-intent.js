// ===== EXIT-INTENT POPUP =====
// Shows when user moves mouse to exit

let exitPopupShown = false;

document.addEventListener('mouseout', (e) => {
    // Only trigger if moving to top (exiting window)
    if (e.clientY <= 0 && !exitPopupShown) {
        exitPopupShown = true;
        showExitPopup();
    }
});

function showExitPopup() {
    const overlay = document.createElement('div');
    overlay.className = 'exit-popup-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    `;
    
    const popup = document.createElement('div');
    popup.className = 'exit-popup-content';
    popup.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 30px;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        animation: popupScale 300ms ease-out;
    `;
    
    popup.innerHTML = `
        <h2 style="margin: 0 0 10px 0; color: #0a4d68; font-size: 24px;">Wait! 🎉</h2>
        <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
            Book your tour in the next 2 hours and get <strong>instant confirmation</strong> 
            + <strong>free cancellation</strong>
        </p>
        <div style="display: flex; gap: 10px; margin-bottom: 15px;">
            <button onclick="this.closest('.exit-popup-overlay').remove(); exitPopupShown=false;" 
                    style="flex: 1; padding: 12px; border: 2px solid #ddd; background: white; 
                           border-radius: 6px; cursor: pointer; font-weight: 600;">
                Maybe Later
            </button>
            <button onclick="document.getElementById('tours-grid')?.scrollIntoView({behavior:'smooth'}); this.closest('.exit-popup-overlay').remove();"
                    style="flex: 1; padding: 12px; background: #0a4d68; color: white; 
                           border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                Book Now →
            </button>
        </div>
        <p style="margin: 0; color: #999; font-size: 12px;">🔒 Secure booking, No spam</p>
    `;
    
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            exitPopupShown = false;
        }
    });
}

// Add animation
const style = document.createElement('style');
style.textContent = `
    @keyframes popupScale {
        from {
            transform: scale(0.8);
            opacity: 0;
        }
        to {
            transform: scale(1);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);
