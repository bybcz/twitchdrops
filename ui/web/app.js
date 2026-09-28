/* ==========================================================================
   Twitch Drops Miner Pro (By BCZ) - Reactive Frontend Controller
   ========================================================================== */

(function () {
  'use strict';

  // Global App Controller exposed to Python WebView
  window.app = {
    state: {
      isMining: false,
      isLoggedIn: false,
      username: '',
      userId: null,
      claimedDrops: 0,
      pointsEarned: 0,
      wsCount: 0,
      soundEnabled: true,
      currentFilter: 'all',
      searchQuery: '',
      logFilter: 'all',
      campaigns: [],
      channels: [],
      priorityGames: [],
      logs: [],
      deviceCodeUrl: 'https://www.twitch.tv/activate'
    },

    // ------------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------------
    init: function () {
      console.log('Twitch Drops Miner Pro (By BCZ) UI Initializing...');
      if (window.i18n) window.i18n.init();
      this.bindNavigation();
      this.bindControls();
      this.bindAuth();
      this.bindSettings();
      this.bindConsole();
      this.bindInventory();

      // Listen for pywebview ready event
      window.addEventListener('pywebviewready', () => {
        console.log('PyWebView bridge ready.');
        if (window.pywebview && window.pywebview.api) {
          // Load settings and stats
          window.pywebview.api.on_ui_ready().then((initialData) => {
            if (initialData) {
              this.applyInitialState(initialData);
            }
          }).catch(err => console.error('on_ui_ready error:', err));

          // Check current authentication status
          this.checkAuthStatus();
        }
      });
    },

    applyInitialState: function (data) {
      if (data.settings) {
        if (data.settings.language && window.i18n) {
          window.i18n.setLanguage(data.settings.language);
        }
        this.updateSettingsUI(data.settings);
      }
      if (data.priority_games) {
        this.renderPriorityList(data.priority_games);
      }
      if (data.available_games) {
        this.state.availableGames = data.available_games;
        this.updatePriorityDropdown();
      }
      if (data.stats) {
        if (data.stats.claimed !== undefined) this.setClaimedDrops(data.stats.claimed);
        if (data.stats.points !== undefined) this.setPointsEarned(data.stats.points);
      }
    },

    checkAuthStatus: function () {
      if (!window.pywebview || !window.pywebview.api) return;
      window.pywebview.api.get_auth_status().then((res) => {
        if (res && res.logged_in) {
          this.updateAuthUI(true, res.username || 'Twitch Hesabı', res.user_id);
        } else {
          this.updateAuthUI(false);
          // If not logged in, prompt user clearly by showing the login tab or alert
          const alertBanner = document.getElementById('dashboard-auth-alert');
          if (alertBanner) alertBanner.style.display = 'flex';
        }
      }).catch(err => {
        console.warn('get_auth_status error:', err);
      });
    },

    updateAuthUI: function (isLoggedIn, username, userId) {
      this.state.isLoggedIn = isLoggedIn;
      this.state.username = username || '';
      this.state.userId = userId || null;

      // Header Button
      const headerAuthBtn = document.getElementById('header-auth-btn');
      const headerAuthIcon = document.getElementById('header-auth-icon');
      const headerAuthLabel = document.getElementById('header-auth-label');
      if (headerAuthBtn) {
        if (isLoggedIn) {
          headerAuthBtn.className = 'btn btn-auth-header connected';
          if (headerAuthIcon) headerAuthIcon.innerText = '👤';
          if (headerAuthLabel) headerAuthLabel.innerText = username || 'Bağlı Hesap';
        } else {
          headerAuthBtn.className = 'btn btn-auth-header not-connected';
          if (headerAuthIcon) headerAuthIcon.innerText = '🔑';
          if (headerAuthLabel) headerAuthLabel.innerText = 'Giriş Yap';
        }
      }

      // Sidebar Profile Box
      const sidebarDot = document.getElementById('sidebar-online-dot');
      const sidebarUser = document.getElementById('sidebar-username');
      const sidebarRole = document.getElementById('sidebar-role');
      const navBadgeAuth = document.getElementById('nav-badge-auth');

      if (isLoggedIn) {
        if (sidebarDot) sidebarDot.className = 'sidebar-online-dot online';
        if (sidebarUser) sidebarUser.innerText = username || 'Twitch Hesabı';
        if (sidebarRole) sidebarRole.innerText = '🟢 Oturum Açık';
        if (navBadgeAuth) {
          navBadgeAuth.className = 'badge badge-auth logged';
          navBadgeAuth.innerText = 'Bağlı';
        }
      } else {
        if (sidebarDot) sidebarDot.className = 'sidebar-online-dot';
        if (sidebarUser) sidebarUser.innerText = 'Giriş Yapılmadı';
        if (sidebarRole) sidebarRole.innerText = '🔴 Bağlantı Yok';
        if (navBadgeAuth) {
          navBadgeAuth.className = 'badge badge-auth not-logged';
          navBadgeAuth.innerText = 'Giriş Yap';
        }
      }

      // Dashboard Alert Banner
      const dashAlert = document.getElementById('dashboard-auth-alert');
      if (dashAlert) {
        dashAlert.style.display = isLoggedIn ? 'none' : 'flex';
      }

      // Login Tab Views
      const connectedCard = document.getElementById('login-connected-card');
      const setupCard = document.getElementById('login-setup-card');
      const connTitle = document.getElementById('connected-user-title');
      const connSubtitle = document.getElementById('connected-user-subtitle');

      if (isLoggedIn) {
        if (connectedCard) connectedCard.style.display = 'block';
        if (setupCard) setupCard.style.display = 'none';
        if (connTitle) connTitle.innerText = username || 'Twitch Kullanıcısı';
        if (connSubtitle) {
          connSubtitle.innerText = userId ? `Kullanıcı ID: ${userId} • 7/24 Kesintisiz Madencilik Aktif` : 'Oturum aktif ve çalışıyor.';
        }
      } else {
        if (connectedCard) connectedCard.style.display = 'none';
        if (setupCard) setupCard.style.display = 'block';
        this.resetDeviceFlowUI();
      }

      // About Tab Status
      const aboutStatus = document.getElementById('about-auth-status-text');
      if (aboutStatus) {
        if (isLoggedIn) {
          aboutStatus.innerText = `Oturum Açık (${username || 'Bağlı'})`;
          aboutStatus.style.color = 'var(--accent-green)';
        } else {
          aboutStatus.innerText = 'Giriş Yapılmadı (Bağlantı Yok)';
          aboutStatus.style.color = 'var(--accent-red)';
        }
      }
    },

    // ------------------------------------------------------------------------
    // Navigation
    // ------------------------------------------------------------------------
    goToTab: function (targetTab) {
      const navItems = document.querySelectorAll('.nav-item[data-tab]');
      const tabPanes = document.querySelectorAll('.tab-pane');

      navItems.forEach(nav => nav.classList.remove('active'));
      tabPanes.forEach(pane => pane.classList.remove('active'));

      const activeNav = document.querySelector(`.nav-item[data-tab="${targetTab}"]`);
      if (activeNav) activeNav.classList.add('active');

      const targetPane = document.getElementById(`tab-${targetTab}`);
      if (targetPane) targetPane.classList.add('active');
    },

    bindNavigation: function () {
      const navItems = document.querySelectorAll('.nav-item[data-tab]');
      navItems.forEach(item => {
        item.addEventListener('click', () => {
          const targetTab = item.getAttribute('data-tab');
          this.goToTab(targetTab);
        });
      });
    },

    // ------------------------------------------------------------------------
    // Twitch Login & Auth Handling
    // ------------------------------------------------------------------------
    bindAuth: function () {
      const api = () => (window.pywebview && window.pywebview.api);

      // Header Auth Button -> Takes user to Login tab
      const headerAuthBtn = document.getElementById('header-auth-btn');
      if (headerAuthBtn) {
        headerAuthBtn.addEventListener('click', () => {
          this.goToTab('login');
        });
      }

      // Sidebar Profile Box -> Also navigates to login
      const sidebarProfile = document.getElementById('sidebar-profile');
      if (sidebarProfile) {
        sidebarProfile.addEventListener('click', () => {
          this.goToTab('login');
        });
      }

      // Dashboard Banner "Şimdi Giriş Yap" button
      const btnBannerGoLogin = document.getElementById('btn-banner-go-login');
      if (btnBannerGoLogin) {
        btnBannerGoLogin.addEventListener('click', () => {
          this.goToTab('login');
        });
      }

      // About Tab "Hesabı Yönet" button
      const btnAboutAuth = document.getElementById('btn-about-manage-auth');
      if (btnAboutAuth) {
        btnAboutAuth.addEventListener('click', () => {
          this.goToTab('login');
        });
      }

      // Subtabs (Device Code vs Manual Token)
      const subtabBtns = document.querySelectorAll('.login-subtab-btn');
      subtabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          subtabBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const target = btn.getAttribute('data-subtab');
          document.querySelectorAll('.login-subtab-content').forEach(c => c.classList.remove('active'));
          const targetContent = document.getElementById(`subtab-${target}`);
          if (targetContent) targetContent.classList.add('active');
        });
      });

      // Button: Get Device Code (Start Login)
      const btnGetCode = document.getElementById('btn-get-device-code');
      if (btnGetCode) {
        btnGetCode.addEventListener('click', () => {
          this.setDeviceFlowState('loading');
          this.showToast('Twitch giriş kodu isteniyor...', 'info');
          if (api()) {
            api().start_twitch_login();
          }
        });
      }

      // Button: Copy Device Code
      const btnCopyCode = document.getElementById('btn-copy-device-code');
      if (btnCopyCode) {
        btnCopyCode.addEventListener('click', () => {
          const codeText = document.getElementById('display-user-code').innerText;
          if (codeText && codeText !== '---- ----') {
            navigator.clipboard.writeText(codeText.replace(/\s+/g, '')).then(() => {
              this.showToast('Kod panoya kopyalandı! 📋', 'success');
            });
          }
        });
      }

      // Button: Open Twitch Activation Page in Browser
      const btnOpenActivate = document.getElementById('btn-open-twitch-activate');
      if (btnOpenActivate) {
        btnOpenActivate.addEventListener('click', () => {
          const url = this.state.deviceCodeUrl || 'https://www.twitch.tv/activate';
          this.openExternal(url);
          this.showToast('Twitch aktivasyon sayfası tarayıcıda açıldı.', 'info');
        });
      }

      // Button: Retry Device Code
      const btnRetryCode = document.getElementById('btn-retry-device-code');
      if (btnRetryCode) {
        btnRetryCode.addEventListener('click', () => {
          this.setDeviceFlowState('idle');
        });
      }

      // Button: Save Manual Token
      const btnSaveManual = document.getElementById('btn-save-manual-token');
      const inputManual = document.getElementById('manual-token-input');
      if (btnSaveManual && inputManual) {
        btnSaveManual.addEventListener('click', () => {
          const token = inputManual.value.trim();
          if (!token) {
            this.showToast('Lütfen auth-token değerini girin.', 'error');
            return;
          }
          this.showToast('Token doğrulanıyor...', 'info');
          if (api()) {
            api().save_manual_token(token).then(res => {
              if (res && res.success) {
                this.showToast('Token başarıyla kaydedildi!', 'success');
                inputManual.value = '';
              } else {
                this.showToast('Token hatası: ' + (res.error || 'Geçersiz token'), 'error');
              }
            });
          }
        });
      }

      // Button: Reconnect / Validate in Connected state
      const btnReconnect = document.getElementById('btn-reconnect-twitch');
      if (btnReconnect) {
        btnReconnect.addEventListener('click', () => {
          this.showToast('Oturum yenileniyor...', 'info');
          if (api()) {
            api().start_twitch_login();
          }
        });
      }

      // Button: Logout Main
      const btnLogoutMain = document.getElementById('btn-logout-main');
      if (btnLogoutMain) {
        btnLogoutMain.addEventListener('click', () => {
          if (confirm('Twitch oturumunu kapatmak ve kayıtlı çerezleri silmek istiyor musunuz?')) {
            if (api()) {
              api().logout();
            }
          }
        });
      }
    },

    resetDeviceFlowUI: function () {
      this.setDeviceFlowState('idle');
    },

    setDeviceFlowState: function (stateName) {
      const states = ['idle', 'loading', 'code', 'error'];
      states.forEach(s => {
        const el = document.getElementById(`device-state-${s}`);
        if (el) el.style.display = (s === stateName) ? 'flex' : 'none';
      });
    },

    // ------------------------------------------------------------------------
    // Global Header & Action Controls
    // ------------------------------------------------------------------------
    bindControls: function () {
      const api = () => (window.pywebview && window.pywebview.api);

      // Mining Toggle Button
      const btnToggleMining = document.getElementById('btn-toggle-mining');
      if (btnToggleMining) {
        btnToggleMining.addEventListener('click', () => {
          if (api()) api().toggle_mining();
        });
      }

      // Reload Campaigns Button
      const btnReload = document.getElementById('btn-reload');
      if (btnReload) {
        btnReload.addEventListener('click', () => {
          this.showToast('Kampanyalar yenileniyor...', 'info');
          if (api()) api().reload_campaigns();
        });
      }

      // Theme Switcher
      const btnTheme = document.getElementById('btn-theme');
      if (btnTheme) {
        btnTheme.addEventListener('click', () => {
          const body = document.body;
          const isDark = body.getAttribute('data-theme') === 'dark';
          const newTheme = isDark ? 'light' : 'dark';
          body.setAttribute('data-theme', newTheme);
          btnTheme.innerText = isDark ? '☀️' : '🌙';
          if (api()) api().set_dark_mode(!isDark);
        });
      }

      // Open Stream in browser
      const btnOpenStream = document.getElementById('btn-open-stream');
      if (btnOpenStream) {
        btnOpenStream.addEventListener('click', () => {
          const channelName = document.getElementById('watching-channel-name').innerText;
          if (channelName && channelName !== 'Yayıncı Bekleniyor...' && channelName !== '-') {
            this.openExternal(`https://www.twitch.tv/${channelName}`);
          } else {
            this.openExternal('https://www.twitch.tv/drops/inventory');
          }
        });
      }

      // Open GitHub button
      const btnOpenGitHub = document.getElementById('btn-open-github');
      if (btnOpenGitHub) {
        btnOpenGitHub.addEventListener('click', () => {
          this.openExternal('https://github.com/beratcemzengin/TwitchDropsMiner');
        });
      }
    },

    // ------------------------------------------------------------------------
    // Settings Binding
    // ------------------------------------------------------------------------
    bindSettings: function () {
      const api = () => (window.pywebview && window.pywebview.api);

      const toggles = [
        { id: 'setting-auto-claim', key: 'autoclaim' },
        { id: 'setting-channel-points', key: 'claim_channel_points' },
        { id: 'setting-watchdog', key: 'watchdog_recovery' },
        { id: 'setting-sound', key: 'sound_enabled', isLocal: true },
        { id: 'setting-tray', key: 'tray' }
      ];

      toggles.forEach(t => {
        const el = document.getElementById(t.id);
        if (el) {
          el.addEventListener('change', (e) => {
            if (t.isLocal && t.key === 'sound_enabled') {
              this.state.soundEnabled = e.target.checked;
            } else if (api()) {
              api().save_single_setting(t.key, e.target.checked);
            }
          });
        }
      });

      // Priority Game Add
      const btnAddPriority = document.getElementById('btn-add-priority');
      const selectPriority = document.getElementById('priority-game-select');
      if (btnAddPriority && selectPriority) {
        btnAddPriority.addEventListener('click', () => {
          const game = selectPriority.value.trim();
          if (game && !this.state.priorityGames.includes(game)) {
            this.state.priorityGames.push(game);
            this.renderPriorityList(this.state.priorityGames);
            if (api()) api().save_priority_games(this.state.priorityGames);
          }
        });
      }

      // Discord Webhook Test
      const btnTestDiscord = document.getElementById('btn-test-discord');
      const inputDiscord = document.getElementById('setting-discord-webhook');
      if (btnTestDiscord && inputDiscord) {
        btnTestDiscord.addEventListener('click', () => {
          const url = inputDiscord.value.trim();
          if (!url) {
            this.showToast('Lütfen geçerli bir Discord Webhook URL girin', 'error');
            return;
          }
          this.showToast('Discord bildirimi test ediliyor...', 'info');
          if (api()) {
            api().test_discord_webhook(url).then(res => {
              if (res && res.success) {
                this.showToast('Discord bildirimi başarıyla gönderildi!', 'success');
              } else {
                this.showToast('Discord bildirimi başarısız: ' + (res.error || 'Hata'), 'error');
              }
            });
          }
        });

        inputDiscord.addEventListener('change', () => {
          if (api()) api().save_single_setting('discord_webhook', inputDiscord.value.trim());
        });
      }

      // Telegram Webhook Test
      const btnTestTelegram = document.getElementById('btn-test-telegram');
      const inputTelegramToken = document.getElementById('setting-telegram-token');
      const inputTelegramChatId = document.getElementById('setting-telegram-chatid');
      if (btnTestTelegram && inputTelegramToken && inputTelegramChatId) {
        btnTestTelegram.addEventListener('click', () => {
          const token = inputTelegramToken.value.trim();
          const chatId = inputTelegramChatId.value.trim();
          if (!token || !chatId) {
            this.showToast('Lütfen Telegram Bot Token ve Chat ID girin', 'error');
            return;
          }
          this.showToast('Telegram bildirimi test ediliyor...', 'info');
          if (api()) {
            api().test_telegram_webhook(token, chatId).then(res => {
              if (res && res.success) {
                this.showToast('Telegram bildirimi başarıyla gönderildi!', 'success');
              } else {
                this.showToast('Telegram bildirimi başarısız: ' + (res.error || 'Hata'), 'error');
              }
            });
          }
        });

        const saveTelegram = () => {
          if (api()) {
            api().save_single_setting('telegram_token', inputTelegramToken.value.trim());
            api().save_single_setting('telegram_chat_id', inputTelegramChatId.value.trim());
          }
        };
        inputTelegramToken.addEventListener('change', saveTelegram);
        inputTelegramChatId.addEventListener('change', saveTelegram);
      }

      // Language Selection Dropdown
      const langSelect = document.getElementById('setting-language-select');
      if (langSelect) {
        langSelect.addEventListener('change', (e) => {
          const newLang = e.target.value;
          if (window.i18n) window.i18n.setLanguage(newLang);
          if (api()) api().save_single_setting('language', newLang);
        });
      }

      // Reload Inventory / Campaigns from Settings (Matches original app Reload)
      const btnSettingsReload = document.getElementById('btn-settings-reload');
      if (btnSettingsReload) {
        btnSettingsReload.addEventListener('click', () => {
          this.reloadInventory();
        });
      }
    },

    updateSettingsUI: function (s) {
      if (s.language !== undefined) {
        const langSelect = document.getElementById('setting-language-select');
        if (langSelect) langSelect.value = s.language;
        if (window.i18n) window.i18n.setLanguage(s.language);
      }
      if (s.autoclaim !== undefined) document.getElementById('setting-auto-claim').checked = s.autoclaim;
      if (s.claim_channel_points !== undefined) document.getElementById('setting-channel-points').checked = s.claim_channel_points;
      if (s.watchdog_recovery !== undefined) document.getElementById('setting-watchdog').checked = s.watchdog_recovery;
      if (s.tray !== undefined) document.getElementById('setting-tray').checked = s.tray;
      if (s.discord_webhook !== undefined) document.getElementById('setting-discord-webhook').value = s.discord_webhook || '';
      if (s.telegram_token !== undefined) document.getElementById('setting-telegram-token').value = s.telegram_token || '';
      if (s.telegram_chat_id !== undefined) document.getElementById('setting-telegram-chatid').value = s.telegram_chat_id || '';
    },

    renderPriorityList: function (games) {
      this.state.priorityGames = games || [];
      const container = document.getElementById('priority-list-container');
      if (!container) return;

      if (!games || games.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 14px;">Öncelikli oyun eklenmedi. Tüm aktif kampanyalar varsayılan sırayla izlenir.</div>`;
        return;
      }

      container.innerHTML = games.map((game, idx) => {
        const camp = this.state.campaigns.find(c => (c.game && c.game.toLowerCase() === game.toLowerCase()) || (c.name && c.name.toLowerCase() === game.toLowerCase()));
        let linkBadge = '';
        if (camp) {
          const isLinked = Boolean(camp.linked || camp.eligible);
          if (camp.finished) {
            linkBadge += `<span class="campaign-link-badge" style="font-size: 10px; padding: 2px 6px; margin-left: 6px; background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);">Completed ✔</span>`;
          }
          if (isLinked) {
            const linkedText = window.i18n ? window.i18n.t('status_linked') : 'Linked ✔';
            linkBadge += `<span class="campaign-link-badge linked" style="font-size: 10px; padding: 2px 6px; margin-left: 6px; cursor: pointer;" onclick="event.stopPropagation(); window.app.linkCampaign('${camp.id}')" title="${linkedText} - Click to open game page">${linkedText} 🔗</span>`;
          } else {
            const notLinkedText = window.i18n ? window.i18n.t('status_not_linked') : 'Not Linked ❌';
            const linkAccountText = window.i18n ? window.i18n.t('btn_link_account') : 'Hesabı Bağla';
            linkBadge += `<span class="campaign-link-badge not-linked" style="font-size: 10px; padding: 2px 6px; margin-left: 6px; cursor: pointer;" onclick="event.stopPropagation(); window.app.linkCampaign('${camp.id}')" title="${linkAccountText}">${notLinkedText}</span>`;
          }
        }

        return `
        <div class="priority-item">
          <div class="priority-item-title" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
            <span style="color: var(--twitch-purple); font-weight: 800;">#${idx + 1}</span>
            <span>${this.escapeHtml(game)}</span>
            ${linkBadge}
          </div>
          <div class="priority-item-controls">
            ${idx > 0 ? `<button class="priority-btn" onclick="window.app.movePriority(${idx}, -1)" title="Yukarı Taşı">▲</button>` : ''}
            ${idx < games.length - 1 ? `<button class="priority-btn" onclick="window.app.movePriority(${idx}, 1)" title="Aşağı Taşı">▼</button>` : ''}
            <button class="priority-btn" onclick="window.app.removePriority(${idx})" title="Sil" style="color: #ff6b6b;">✖</button>
          </div>
        </div>
      `;
      }).join('');
    },

    movePriority: function (index, delta) {
      const targetIndex = index + delta;
      if (targetIndex < 0 || targetIndex >= this.state.priorityGames.length) return;
      const item = this.state.priorityGames.splice(index, 1)[0];
      this.state.priorityGames.splice(targetIndex, 0, item);
      this.renderPriorityList(this.state.priorityGames);
      if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.save_priority_games(this.state.priorityGames);
      }
    },

    removePriority: function (index) {
      this.state.priorityGames.splice(index, 1);
      this.renderPriorityList(this.state.priorityGames);
      if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.save_priority_games(this.state.priorityGames);
      }
    },

    // ------------------------------------------------------------------------
    // Inventory Filtering & Display
    // ------------------------------------------------------------------------
    bindInventory: function () {
      const searchInput = document.getElementById('search-inventory');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this.state.searchQuery = e.target.value.toLowerCase();
          this.renderCampaigns();
        });
      }

      const filterButtons = document.querySelectorAll('.filter-btn');
      filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          filterButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.state.currentFilter = btn.getAttribute('data-filter');
          this.renderCampaigns();
        });
      });

      const btnRefreshInv = document.getElementById('btn-refresh-inventory');
      if (btnRefreshInv) {
        btnRefreshInv.addEventListener('click', () => {
          this.reloadInventory();
        });
      }
    },

    renderCampaigns: function () {
      const grid = document.getElementById('campaigns-grid');
      const badge = document.getElementById('nav-badge-campaigns');
      if (!grid) return;

      const filtered = this.state.campaigns.filter(c => {
        const matchesSearch = !this.state.searchQuery ||
          (c.game && c.game.toLowerCase().includes(this.state.searchQuery)) ||
          (c.name && c.name.toLowerCase().includes(this.state.searchQuery));

        if (!matchesSearch) return false;

        if (this.state.currentFilter === 'active') return c.status === 'ACTIVE';
        if (this.state.currentFilter === 'upcoming') return c.status === 'UPCOMING';
        if (this.state.currentFilter === 'not_linked') return !(c.linked || c.eligible);
        if (this.state.currentFilter === 'expired') return c.status === 'EXPIRED';
        return true;
      });

      if (badge) badge.innerText = this.state.campaigns.length;

      if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;">Eşleşen kampanya bulunamadı.</div>`;
        return;
      }

      grid.innerHTML = filtered.map(c => {
        const isLinked = Boolean(c.linked || c.eligible);
        const linkedText = window.i18n ? window.i18n.t('status_linked') : 'Linked ✔';
        const notLinkedText = window.i18n ? window.i18n.t('status_not_linked') : 'Not Linked ❌';
        const linkAccountText = window.i18n ? window.i18n.t('btn_link_account') : 'Hesabı Bağla';
        const endsPrefix = window.i18n ? window.i18n.t('ends_label') : 'Ends:';
        const startsPrefix = window.i18n ? window.i18n.t('starts_label') : 'Starts:';
        const allowedChannelsPrefix = window.i18n ? window.i18n.t('allowed_channels_label') : 'Allowed Channels:';

        const linkBadge = isLinked
          ? `<span class="campaign-link-badge linked" onclick="event.stopPropagation(); window.app.linkCampaign('${c.id}')" title="${linkedText} - Click to open game page">${linkedText} 🔗</span>`
          : `<span class="campaign-link-badge not-linked" onclick="event.stopPropagation(); window.app.linkCampaign('${c.id}')" title="${notLinkedText} - ${linkAccountText}">${notLinkedText}</span>`;

        const dateStr = c.status === 'UPCOMING'
          ? `${startsPrefix} ${c.starts_at || '-'}`
          : `${endsPrefix} ${c.ends_at || '-'}`;

        return `
        <div class="campaign-card ${c.finished ? 'completed-campaign' : ''}">
          <div class="campaign-top-bar">
            <span class="campaign-name-title" title="${this.escapeHtml(c.name)}">${this.escapeHtml(c.name)}</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              ${c.finished ? `<span class="campaign-status-badge" style="background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);">Completed ✔ (${c.claimed_drops || c.drops.length}/${c.total_drops || c.drops.length})</span>` : ''}
              <span class="campaign-status-badge ${c.status.toLowerCase()}">${c.status}</span>
            </div>
          </div>

          <div class="campaign-body">
            <div class="campaign-left-info">
              <img src="${c.icon_url || 'https://static-cdn.jtvnw.net/ttv-static/404_boxart-52x72.jpg'}" alt="${this.escapeHtml(c.game)}" class="campaign-game-cover">
              <div class="campaign-meta-details">
                <span class="campaign-game-name">${this.escapeHtml(c.game)}</span>
                <span class="campaign-dates">${dateStr}</span>
                <div>${linkBadge}</div>
                <span class="campaign-channels">${allowedChannelsPrefix} ${this.escapeHtml(c.allowed_channels || 'All')}</span>
              </div>
            </div>

            <div class="campaign-right-drops">
              ${c.drops.map(d => `
                <div class="campaign-drop-box ${d.is_claimed ? 'claimed' : ''}" title="${this.escapeHtml(d.name)}">
                  <span class="campaign-drop-name">${d.is_claimed ? '✔ ' : ''}${this.escapeHtml(d.name)}</span>
                  ${d.image_url ? `<img src="${d.image_url}" alt="Reward">` : `<div style="font-size: 26px;">🎁</div>`}
                  <span class="campaign-drop-time">${d.is_claimed ? (d.required_minutes || d.current_minutes) : d.current_minutes}/${d.required_minutes} min</span>
                  <div class="drop-progress-track" style="width: 100%; height: 4px; margin-top: 2px;">
                    <div class="drop-progress-fill" style="width: ${d.is_claimed ? 100 : d.percentage}%;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        `;
      }).join('');
    },

    updatePriorityDropdown: function () {
      const select = document.getElementById('priority-game-select');
      if (!select) return;

      const gamesFromCampaigns = this.state.campaigns.map(c => c.game).filter(Boolean);
      const gamesFromAvailable = this.state.availableGames || [];
      const games = [...new Set([...gamesFromCampaigns, ...gamesFromAvailable])].sort();
      const placeholder = window.i18n ? window.i18n.t('setting_priority_select') : 'Select game from active campaigns...';

      select.innerHTML = `<option value="">${placeholder}</option>` +
        games.map(g => {
          const campaign = this.state.campaigns.find(c => c.game && c.game.toLowerCase() === g.toLowerCase());
          let linkStatusSuffix = '';
          if (campaign) {
            const isLinked = Boolean(campaign.linked || campaign.eligible);
            if (campaign.finished) {
              linkStatusSuffix = ' (✔ Completed)';
            } else {
              linkStatusSuffix = isLinked ? ' (✔ Linked)' : ' (❌ Not Linked)';
            }
          }
          return `<option value="${this.escapeHtml(g)}">${this.escapeHtml(g)}${linkStatusSuffix}</option>`;
        }).join('');
    },


    // ------------------------------------------------------------------------
    // Console & Logs Binding
    // ------------------------------------------------------------------------
    bindConsole: function () {
      const filterBtns = document.querySelectorAll('.console-filter-btn');
      filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          filterBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.state.logFilter = btn.getAttribute('data-log-filter');
          this.renderLogs();
        });
      });

      const btnClear = document.getElementById('btn-clear-logs');
      if (btnClear) {
        btnClear.addEventListener('click', () => {
          this.state.logs = [];
          this.renderLogs();
        });
      }

      const btnCopy = document.getElementById('btn-copy-logs');
      if (btnCopy) {
        btnCopy.addEventListener('click', () => {
          const text = this.state.logs.map(l => `[${l.time}] ${l.message}`).join('\n');
          navigator.clipboard.writeText(text).then(() => {
            this.showToast('Loglar panoya kopyalandı', 'success');
          });
        });
      }
    },

    addLog: function (message, type) {
      type = type || 'mining';
      const time = new Date().toLocaleTimeString();
      this.state.logs.push({ time, message, type });

      if (this.state.logs.length > 500) {
        this.state.logs.shift();
      }

      this.renderLogs();
    },

    renderLogs: function () {
      const output = document.getElementById('console-logs-output');
      if (!output) return;

      const filtered = this.state.logs.filter(l => {
        if (this.state.logFilter === 'all') return true;
        return l.type === this.state.logFilter;
      });

      output.innerHTML = filtered.map(l => `
        <div class="log-line">
          <span class="log-time">[${l.time}]</span>
          <span class="log-type-${l.type}">${this.escapeHtml(l.message)}</span>
        </div>
      `).join('');

      output.scrollTop = output.scrollHeight;
    },

    // ------------------------------------------------------------------------
    // Channel / Streamer Management
    // ------------------------------------------------------------------------
    renderChannels: function (channels) {
      this.state.channels = channels || [];
      const miniBody = document.getElementById('channels-table-body');
      const fullBody = document.getElementById('full-channels-table-body');
      const summaryText = document.getElementById('channels-summary-text');
      const badge = document.getElementById('nav-badge-channels');

      if (summaryText) summaryText.innerText = `${this.state.channels.length} kanal bulundu`;
      if (badge) badge.innerText = this.state.channels.length;

      if (!channels || channels.length === 0) {
        const emptyMsg = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">Henüz uygun kanal bulunamadı.</td></tr>`;
        if (miniBody) miniBody.innerHTML = emptyMsg;
        if (fullBody) fullBody.innerHTML = emptyMsg;
        return;
      }

      const rows = channels.map(ch => `
        <tr class="${ch.is_watching ? 'watching-row' : ''}">
          <td style="font-weight: 700; color: var(--text-highlight);">
            ${ch.is_watching ? '🟣 ' : ''}${this.escapeHtml(ch.name)}
          </td>
          <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${this.escapeHtml(ch.title || '-')}
          </td>
          <td>${this.escapeHtml(ch.game || '-')}</td>
          <td>👥 ${ch.viewers ? ch.viewers.toLocaleString() : '0'}</td>
          <td>
            <span class="campaign-status-badge ${ch.live ? 'active' : 'expired'}">
              ${ch.live ? 'CANLI' : 'ÇEVRİMDIŞI'}
            </span>
          </td>
          <td>
            <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.app.selectChannel('${ch.name}')">
              İzle
            </button>
          </td>
        </tr>
      `).join('');

      if (miniBody) miniBody.innerHTML = rows;
      if (fullBody) fullBody.innerHTML = rows;
    },

    selectChannel: function (channelName) {
      if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.switch_channel(channelName);
      }
    },

    // ------------------------------------------------------------------------
    // Real-Time Events Pushed from Python
    // ------------------------------------------------------------------------
    onEvent: function (eventType, data) {
      switch (eventType) {
        case 'status':
          this.handleStatusUpdate(data);
          break;

        case 'log':
          this.addLog(data.message, data.type);
          break;

        case 'watching':
          this.handleWatchingUpdate(data);
          break;

        case 'drop_progress':
          this.handleDropProgress(data);
          break;

        case 'claim':
          this.handleDropClaim(data);
          break;

        case 'point_bonus':
          this.handlePointBonus(data);
          break;

        case 'inventory':
          this.state.campaigns = data.campaigns || [];
          this.renderCampaigns();
          this.updatePriorityDropdown();
          this.renderPriorityList(this.state.priorityGames);
          break;

        case 'channels':
          this.renderChannels(data.channels);
          break;

        case 'available_games':
          this.state.availableGames = data.games || [];
          this.updatePriorityDropdown();
          break;

        case 'ws_count':
          const wsEl = document.getElementById('stat-ws');
          if (wsEl) wsEl.innerText = `${data.count} WS`;
          break;


        // ── Twitch Login Events ──────────────────────────────────────────
        case 'login_show_code':
          this.goToTab('login');
          this.setDeviceFlowState('code');
          this.state.deviceCodeUrl = data.url || 'https://www.twitch.tv/activate';
          const displayCode = document.getElementById('display-user-code');
          if (displayCode) displayCode.innerText = data.code || '---- ----';
          this.showToast('Giriş kodu alındı! Lütfen Twitch sayfasında onaylayın.', 'info');
          break;

        case 'login_confirmed':
          this.showToast('Twitch doğrulaması bekleniyor...', 'info');
          break;

        case 'login_success':
          this.updateAuthUI(true, data.username || 'Twitch Kullanıcısı', data.user_id);
          this.showToast('Twitch girişi başarıyla tamamlandı! 🎉', 'success');
          // Automatically switch back to Dashboard after 1.5 seconds
          setTimeout(() => {
            this.goToTab('dashboard');
          }, 1500);
          break;

        case 'login_logged_out':
          this.updateAuthUI(false);
          this.showToast('Twitch oturumu kapatıldı.', 'info');
          break;

        case 'login_error':
          this.setDeviceFlowState('error');
          const errEl = document.getElementById('device-error-msg');
          if (errEl) errEl.innerText = data.error || 'Bağlantı hatası oluştu.';
          this.showToast('Giriş hatası: ' + (data.error || 'Hata'), 'error');
          break;
      }
    },

    handleStatusUpdate: function (data) {
      const dot = document.getElementById('status-dot');
      const text = document.getElementById('status-text');
      const btnToggle = document.getElementById('btn-toggle-mining');

      if (dot) {
        dot.className = `status-dot ${data.state || 'idle'}`;
      }
      if (text) {
        text.innerText = data.text || (window.i18n ? window.i18n.t('status_idle') : 'Idle');
      }

      if (btnToggle) {
        const pauseText = window.i18n ? window.i18n.t('btn_pause') : 'Pause';
        const startText = window.i18n ? window.i18n.t('btn_start') : 'Start';
        if (data.is_running) {
          btnToggle.innerHTML = `<span>⏸</span> ${pauseText}`;
          btnToggle.className = 'btn btn-secondary';
        } else {
          btnToggle.innerHTML = `<span>▶</span> ${startText}`;
          btnToggle.className = 'btn btn-twitch';
        }
      }
    },

    handleWatchingUpdate: function (data) {
      const nameEl = document.getElementById('watching-channel-name');
      const gameEl = document.getElementById('watching-game-title');
      const viewersEl = document.getElementById('watching-viewers');
      const uptimeEl = document.getElementById('watching-uptime');
      const liveBadge = document.getElementById('watching-live-badge');
      const avatar = document.getElementById('watching-avatar');
      const fallback = document.getElementById('watching-avatar-fallback');
      const letterEl = document.getElementById('watching-avatar-letter');

      const isWaiting = !data.name || data.name === 'Yayıncı Bekleniyor...' || data.name === 'Waiting for Streamer...';
      const channelName = isWaiting ? (window.i18n ? window.i18n.t('watching_waiting') : 'Waiting for Streamer...') : data.name;

      if (nameEl) nameEl.innerText = channelName;
      if (gameEl) {
        const gamePrefix = window.i18n ? window.i18n.t('watching_game_prefix') : 'Game:';
        gameEl.innerText = `${gamePrefix} ${data.game || '-'}`;
      }
      if (viewersEl) viewersEl.innerText = data.viewers ? data.viewers.toLocaleString() : '0';
      if (uptimeEl) uptimeEl.innerText = data.uptime || '00:00';

      if (liveBadge) {
        const liveText = window.i18n ? (data.live ? window.i18n.t('status_live') : window.i18n.t('status_offline')) : (data.live ? 'LIVE' : 'OFFLINE');
        liveBadge.innerText = liveText;
        liveBadge.style.backgroundColor = data.live ? 'var(--accent-red)' : 'var(--text-muted)';
      }

      // Streamer Avatar with Letter fallback
      const initial = (!isWaiting && channelName.length > 0) ? channelName.charAt(0).toUpperCase() : '📺';
      if (letterEl) letterEl.innerText = initial;

      if (avatar && fallback) {
        if (data.avatar && typeof data.avatar === 'string' && data.avatar.trim() !== '') {
          avatar.src = data.avatar;
          avatar.style.display = 'block';
          fallback.style.display = 'none';
          avatar.onerror = () => {
            avatar.style.display = 'none';
            fallback.style.display = 'flex';
          };
        } else {
          avatar.style.display = 'none';
          fallback.style.display = 'flex';
        }
      }
    },

    updateDropUI: function () {
      const titleEl = document.getElementById('active-campaign-title');
      const nameEl = document.getElementById('active-drop-name');
      const barEl = document.getElementById('active-progress-bar');
      const textEl = document.getElementById('active-progress-text');
      const etaEl = document.getElementById('active-eta-text');
      const radialCircle = document.getElementById('radial-fill-circle');
      const radialText = document.getElementById('radial-percentage-text');
      const dropImg = document.getElementById('active-drop-img');
      const dropPlaceholder = document.getElementById('active-drop-placeholder');

      if (!this.state.activeDropName) return;

      if (titleEl) {
        const baseTitle = this.state.activeCampaignTitle || (window.i18n ? window.i18n.t('drop_showcase_title') : 'ACTIVE DROP CAMPAIGN');
        if (this.state.campaignLinked === false) {
          const notLinkedText = window.i18n ? window.i18n.t('status_not_linked') : 'Not Linked ❌';
          const linkPrompt = window.i18n ? window.i18n.t('btn_link_account') : 'Link Account';
          titleEl.innerHTML = `${this.escapeHtml(baseTitle)} <span class="campaign-link-badge not-linked" style="cursor: pointer; font-size: 11px; margin-left: 8px; vertical-align: middle;" onclick="window.app.openActiveDropLink()" title="${linkPrompt}">${notLinkedText}</span>`;
        } else if (this.state.campaignLinked === true) {
          const linkedText = window.i18n ? window.i18n.t('status_linked') : 'Linked ✔';
          titleEl.innerHTML = `${this.escapeHtml(baseTitle)} <span class="campaign-link-badge linked" style="font-size: 11px; margin-left: 8px; vertical-align: middle;">${linkedText}</span>`;
        } else {
          titleEl.innerText = baseTitle;
        }
      }
      if (nameEl) nameEl.innerText = this.state.activeDropName;

      const totalSec = Math.max(0, this.state.remainingSeconds != null ? this.state.remainingSeconds : 0);
      const reqMins = this.state.requiredMinutes || 0;
      const totalReqSec = reqMins * 60;
      const doneSec = totalReqSec > 0 ? Math.min(totalReqSec, Math.max(0, totalReqSec - totalSec)) : 0;
      const percent = totalReqSec > 0 ? (doneSec / totalReqSec) * 100 : (this.state.percentage || 0);

      // Countdown formatted ETA (e.g. "14m 58s" or "58s")
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const etaPrefix = window.i18n ? window.i18n.t('drop_eta_label') : 'Remaining Time:';
      let etaVal = '';
      if (totalSec <= 0 && reqMins > 0) {
        etaVal = 'Almost Done!';
      } else if (m > 0) {
        etaVal = `${m}m ${s.toString().padStart(2, '0')}s`;
      } else {
        etaVal = `${s}s`;
      }
      if (etaEl) etaEl.innerText = `${etaPrefix} ${etaVal}`;

      // Progress minutes text (e.g. "45 / 60 min")
      const curMins = totalReqSec > 0 ? Math.min(reqMins, Math.floor(doneSec / 60)) : (this.state.currentMinutes || 0);
      const progPrefix = window.i18n ? window.i18n.t('drop_progress_label') : 'Progress:';
      if (textEl) textEl.innerText = `${progPrefix} ${curMins} / ${reqMins} min`;

      if (barEl) barEl.style.width = `${percent.toFixed(1)}%`;
      if (radialText) radialText.innerText = `${Math.round(percent)}%`;
      if (radialCircle) {
        const circumference = 2 * Math.PI * 34;
        const offset = circumference - (percent / 100) * circumference;
        radialCircle.style.strokeDashoffset = offset;
      }

      if (dropImg && dropPlaceholder) {
        if (this.state.activeDropImage) {
          dropImg.src = this.state.activeDropImage;
          dropImg.style.display = 'block';
          dropPlaceholder.style.display = 'none';
        } else {
          dropImg.style.display = 'none';
          dropPlaceholder.style.display = 'block';
        }
      }
    },

    handleDropProgress: function (data) {
      this.state.activeCampaignTitle = data.campaign_title || '';
      this.state.activeDropName = data.drop_name || '';
      this.state.activeDropImage = data.image_url || '';
      this.state.requiredMinutes = data.required_minutes || 0;
      this.state.currentMinutes = data.current_minutes || 0;
      this.state.percentage = data.percentage || 0;
      this.state.remainingSeconds = (data.remaining_seconds != null ? data.remaining_seconds : (data.remaining_minutes || 0) * 60);
      this.state.campaignLinked = data.campaign_linked;
      this.state.campaignLinkUrl = data.campaign_link_url;

      this.updateDropUI();

      if (this.dropTimerInterval) {
        clearInterval(this.dropTimerInterval);
        this.dropTimerInterval = null;
      }

      // Start live 1-second countdown
      if (this.state.remainingSeconds > 0) {
        this.dropTimerInterval = setInterval(() => {
          if (this.state.remainingSeconds > 0) {
            this.state.remainingSeconds -= 1;
            this.updateDropUI();
          } else {
            clearInterval(this.dropTimerInterval);
            this.dropTimerInterval = null;
          }
        }, 1000);
      }
    },

    handleDropClaim: function (data) {
      this.state.claimedDrops += 1;
      this.setClaimedDrops(this.state.claimedDrops);
      this.playClaimSound();
      this.showToast(`🎉 DROP KAZANILDI: ${data.name || ''}`, 'success');
    },

    handlePointBonus: function (data) {
      this.state.pointsEarned += (data.amount || 50);
      this.setPointsEarned(this.state.pointsEarned);
      this.showToast(`🪙 +${data.amount || 50} Kanal Puanı Bonusu Toplandı!`, 'info');
    },

    setClaimedDrops: function (count) {
      const el = document.getElementById('stat-claimed-drops');
      if (el) el.innerText = `${count} Drop`;
    },

    setPointsEarned: function (points) {
      const el = document.getElementById('stat-points');
      if (el) el.innerText = `${points.toLocaleString()} Puan`;
    },

    playClaimSound: function () {
      if (!this.state.soundEnabled) return;
      const audio = document.getElementById('audio-claim');
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    },

    showToast: function (message, type) {
      type = type || 'info';
      const container = document.getElementById('toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.innerHTML = `<span>${this.escapeHtml(message)}</span>`;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse forwards';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    },

    openExternal: function (url) {
      if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.open_external_url(url);
      } else {
        window.open(url, '_blank');
      }
    },

    linkCampaign: function (campaignId) {
      const camp = this.state.campaigns.find(c => c.id === campaignId);
      const url = (camp && camp.link_url && camp.link_url.trim()) ? camp.link_url.trim() : 'https://www.twitch.tv/drops/campaigns';
      this.openExternal(url);
      const isLinked = camp ? Boolean(camp.linked || camp.eligible) : false;
      const gameName = (camp && camp.game) ? camp.game : '';
      let msg = '';
      if (isLinked) {
        msg = gameName ? `${gameName} sayfası tarayıcınızda açıldı.` : 'Oyun sayfası tarayıcınızda açıldı.';
      } else {
        msg = window.i18n ? window.i18n.t('toast_link_opened') : 'Hesap bağlama sayfası tarayıcınızda açıldı. Hesabınızı bağladıktan sonra Envanteri Yenile 🔄 butonuna basabilirsiniz.';
      }
      this.showToast(msg, 'info');
    },

    openActiveDropLink: function () {
      const url = (this.state.campaignLinkUrl && this.state.campaignLinkUrl.trim()) ? this.state.campaignLinkUrl.trim() : 'https://www.twitch.tv/drops/campaigns';
      this.openExternal(url);
      const msg = window.i18n ? window.i18n.t('toast_link_opened') : 'Hesap bağlama sayfası tarayıcınızda açıldı.';
      this.showToast(msg, 'info');
    },

    reloadInventory: function () {
      const msg = window.i18n ? window.i18n.t('toast_reload') : 'Kampanyalar ve envanter yenileniyor...';
      this.showToast(msg, 'info');
      if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.reload_campaigns();
      }
    },

    escapeHtml: function (str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  };

  // Launch when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
  });
})();
