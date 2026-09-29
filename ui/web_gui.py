from __future__ import annotations

import os
import sys
import json
import asyncio
import logging
import webbrowser
from pathlib import Path
from typing import Any, TYPE_CHECKING, cast

import webview
import aiohttp
from core.constants import State

if TYPE_CHECKING:
    from core.twitch import Twitch
    from core.channel import Channel
    from core.inventory import DropsCampaign, TimedDrop
    from core.utils import Game

logger = logging.getLogger("TwitchDrops.gui")


class DummyConfigButton:
    def config(self, **kwargs):
        pass


class DummyHelp:
    def __init__(self):
        self._invalidate_button = DummyConfigButton()


class DummyTray:
    def __init__(self, manager: WebGUIManager):
        self._manager = manager

    def change_icon(self, name: str):
        pass

    def update_title(self, drop: TimedDrop | None = None):
        pass

    def notify(self, message: str, title: str = ""):
        self._manager.print(f"🔔 {title}: {message}")

    def minimize(self):
        pass

    def restore(self):
        pass


class StatusProxy:
    def __init__(self, manager: WebGUIManager):
        self._manager = manager
        self.last_text = "Starting..."

    def update(self, text: str = "", *args, **kwargs):
        self.last_text = str(text)
        lower_t = self.last_text.lower()
        state = "active" if any(w in lower_t for w in ("mining", "izleniyor", "watching", "aktif")) else (
            "connecting" if any(w in lower_t for w in ("gathering", "bağlanılıyor", "switching", "taranıyor", "cleanup")) else "idle"
        )
        key = None
        if any(w in lower_t for w in ("start", "başlat")):
            key = "status_starting"
        elif any(w in lower_t for w in ("gathering", "taranıyor")):
            key = "status_gathering"
        elif any(w in lower_t for w in ("switching", "geçiliyor")):
            key = "status_switching"
        elif any(w in lower_t for w in ("cleanup", "temizle")):
            key = "status_cleanup"
        elif any(w in lower_t for w in ("mining active", "madencilik aktif")):
            key = "status_mining_active"
        elif any(w in lower_t for w in ("mining paused", "madencilik duraklatıldı")):
            key = "status_mining_paused"
        elif any(w in lower_t for w in ("session closed", "oturum kapatıldı")):
            key = "status_session_closed"
        elif any(w in lower_t for w in ("idle", "boşta")):
            key = "status_idle"

        self._manager.emit("status", {
            "text": self.last_text,
            "key": key,
            "state": state,
            "is_running": self._manager._is_mining_running
        })


class WebsocketProxy:
    """Drop-in replacement for WebsocketStatus in gui.py."""

    def __init__(self, manager: WebGUIManager):
        self._manager = manager
        self._items: dict[int, dict] = {}

    def update(self, idx: int, status: str | None = None, topics: int | None = None, *args, **kwargs):
        if idx not in self._items:
            self._items[idx] = {"status": "Connected", "topics": 0}
        if status is not None:
            self._items[idx]["status"] = str(status)
        if topics is not None:
            self._items[idx]["topics"] = int(topics)

        total_topics = sum(v.get("topics", 0) for v in self._items.values())
        active_ws = sum(1 for v in self._items.values() if "disconnect" not in v.get("status", "").lower())
        self._manager.emit("ws_count", {"count": total_topics or active_ws})

    def remove(self, idx: int):
        if idx in self._items:
            del self._items[idx]
        total_topics = sum(v.get("topics", 0) for v in self._items.values())
        self._manager.emit("ws_count", {"count": total_topics})


class LoginProxy:
    """Bridges the core login flow to the WebView JS frontend."""

    def __init__(self, manager: WebGUIManager):
        self._manager = manager
        self.last_status: str = ""
        self.user_id: int | None = None

    async def ask_enter_code(self, url, code: str):
        """Show the device-code login screen in JS and log it."""
        self._manager.emit("login_show_code", {
            "url": str(url),
            "code": str(code),
        })
        self._manager.print(f"Twitch Giriş Kodu: {code} | Doğrulama Sayfası: {url}")
        try:
            webbrowser.open(str(url))
        except Exception:
            pass

    def update(self, status: str, user_id: int | None = None):
        """Called by core/twitch.py to report login status."""
        self.last_status = str(status)
        self.user_id = user_id
        if user_id:
            self._manager.emit("login_success", {
                "username": f"User #{user_id}",
                "user_id": user_id
            })
            self._manager.print(f"Twitch Girişi Başarılı! (Kullanıcı ID: {user_id})")
        else:
            self._manager.emit("login_status", {"status": str(status)})

    def confirm_login(self):
        self._manager.emit("login_confirmed", {})

    def set_logged_in(self, username: str = "", user_id: int | None = None):
        self.user_id = user_id
        self._manager.emit("login_success", {
            "username": username or (f"User #{user_id}" if user_id else ""),
            "user_id": user_id
        })

    def set_logged_out(self):
        self.user_id = None
        self._manager.emit("login_logged_out", {})

    def start_login(self, *args, **kwargs):
        pass

    def update_login(self, *args, **kwargs):
        pass

    def clear(self, *args, **kwargs):
        pass


class ProgressProxy:
    """Campaign and Drop progress tracker compatible with CampaignProgress."""

    def __init__(self, manager: WebGUIManager):
        self._manager = manager
        self._drop: TimedDrop | None = None
        self._timer_task: asyncio.Task | None = None
        self._seconds: int = 60
        self.ALMOST_DONE_SECONDS: int = 10

    def is_displaying(self, drop: TimedDrop) -> bool:
        return self._drop is not None and getattr(self._drop, "id", None) == getattr(drop, "id", None)

    def minute_almost_done(self) -> bool:
        return self._timer_task is None or self._seconds <= self.ALMOST_DONE_SECONDS

    async def _timer_loop(self):
        try:
            while self._seconds > 0:
                await asyncio.sleep(1)
                self._seconds -= 1
        except asyncio.CancelledError:
            pass
        finally:
            self._timer_task = None

    def start_timer(self):
        if self._timer_task is None:
            self._seconds = 60
            self._timer_task = asyncio.create_task(self._timer_loop())

    def stop_timer(self):
        if self._timer_task is not None:
            self._timer_task.cancel()
            self._timer_task = None

    def display(self, drop: TimedDrop | None = None, *, countdown: bool = True, subone: bool = False, **kwargs):
        self._drop = drop
        self.stop_timer()
        if drop is None:
            self._manager.clear_drop()
            return

        current_mins = getattr(drop, "current_minutes", 0)
        req_mins = getattr(drop, "required_minutes", 0)
        rem_mins = getattr(drop, "remaining_minutes", max(0, req_mins - current_mins))
        pct = round(drop.progress * 100, 1) if hasattr(drop, "progress") else (round(current_mins / req_mins * 100, 1) if req_mins > 0 else 0)

        hours, mins = divmod(rem_mins, 60)
        eta = f"{hours}h {mins}m" if hours > 0 else f"{mins}m"

        campaign_title = drop.campaign.name if hasattr(drop, "campaign") and drop.campaign else "Twitch Campaign"
        game_name = drop.campaign.game.name if (hasattr(drop, "campaign") and drop.campaign and drop.campaign.game) else ""

        drop_img = ""
        if getattr(drop, "benefits", None) and getattr(drop.benefits[0], "image_url", None):
            drop_img = str(drop.benefits[0].image_url)
        elif hasattr(drop, "campaign") and getattr(drop.campaign, "image_url", None):
            drop_img = str(drop.campaign.image_url)

        if countdown and rem_mins > 0:
            self.start_timer()

        campaign_linked = getattr(drop.campaign, "linked", True) if hasattr(drop, "campaign") and drop.campaign else True
        campaign_link_url = str(getattr(drop.campaign, "link_url", "")) if hasattr(drop, "campaign") and drop.campaign else ""

        self._manager.emit("drop_progress", {
            "drop_id": getattr(drop, "id", ""),
            "drop_name": getattr(drop, "name", "") or (drop.rewards_text() if hasattr(drop, "rewards_text") else "Drop Reward"),
            "campaign_title": f"{game_name} - {campaign_title}" if game_name else campaign_title,
            "campaign_linked": campaign_linked,
            "campaign_link_url": campaign_link_url,
            "image_url": drop_img,
            "current_minutes": current_mins,
            "required_minutes": req_mins,
            "remaining_minutes": rem_mins,
            "remaining_seconds": rem_mins * 60,
            "percentage": pct,
            "eta": eta
        })




class ChannelsProxy:
    """Channel tracker compatible with ChannelList."""

    def __init__(self, manager: WebGUIManager):
        self._manager = manager
        self._channels: dict[str, dict] = {}
        self._watching_channel: str | None = None
        self._selected_channel_name: str | None = None

    def clear(self):
        self._channels.clear()
        self._manager.emit("channels", {"channels": []})

    def display(self, channel: Any, *, add: bool = False, **kwargs):
        if isinstance(channel, list):
            for ch in channel:
                self._add_or_update_channel(ch, add=add)
        elif channel is not None:
            self._add_or_update_channel(channel, add=add)
        self._emit_channels()

    def _add_or_update_channel(self, ch: Any, add: bool = True):
        name = getattr(ch, "name", str(ch))
        self._channels[name] = {
            "name": name,
            "title": getattr(ch, "title", "") or "",
            "game": getattr(ch.game, "name", "") if getattr(ch, "game", None) else "",
            "viewers": getattr(ch, "viewers", 0) or 0,
            "live": getattr(ch, "online", True),
            "is_watching": (name == self._watching_channel),
            "obj": ch
        }

    def _emit_channels(self):
        data = [{
            "name": v["name"],
            "title": v["title"],
            "game": v["game"],
            "viewers": v["viewers"],
            "live": v["live"],
            "is_watching": (v["name"] == self._watching_channel)
        } for v in self._channels.values()]
        self._manager.emit("channels", {"channels": data})

    def set_watching(self, channel: Channel):
        if not channel:
            return
        self._watching_channel = channel.name
        avatar_url = str(channel.avatar_url) if hasattr(channel, "avatar_url") and channel.avatar_url else ""
        self._manager.emit("watching", {
            "name": channel.name,
            "game": getattr(channel.game, "name", "") if channel.game else "",
            "viewers": getattr(channel, "viewers", 0) or 0,
            "live": getattr(channel, "online", True),
            "uptime": "Live",
            "avatar": avatar_url
        })
        self._emit_channels()

    def clear_watching(self):
        self._watching_channel = None
        self._manager.emit("watching", {
            "name": "",
            "game": "-",
            "viewers": 0,
            "live": False,
            "uptime": "00:00",
            "avatar": ""
        })
        self._emit_channels()

    def get_selection(self) -> Channel | None:
        if self._selected_channel_name and self._selected_channel_name in self._channels:
            return self._channels[self._selected_channel_name]["obj"]
        return None


class InventoryProxy:
    """Inventory tracker compatible with InventoryOverview."""

    def __init__(self, manager: WebGUIManager):
        self._manager = manager
        self.campaigns: dict[str, dict] = {}

    def clear(self):
        self.campaigns.clear()
        self._manager.emit("inventory", {"campaigns": []})

    async def add_campaign(self, campaign: DropsCampaign):
        drops_list = []
        for drop in campaign.drops:
            drop_image = ""
            if getattr(drop, "benefits", None) and getattr(drop.benefits[0], "image_url", None):
                drop_image = str(drop.benefits[0].image_url)

            drops_list.append({
                "id": drop.id,
                "name": getattr(drop, "name", "") or (drop.rewards_text() if hasattr(drop, "rewards_text") else "Drop"),
                "image_url": drop_image,
                "current_minutes": getattr(drop, "current_minutes", 0),
                "required_minutes": getattr(drop, "required_minutes", 0),
                "percentage": round(drop.progress * 100, 1) if hasattr(drop, "progress") else 0,
                "is_claimed": getattr(drop, "is_claimed", False)
            })

        status_str = "ACTIVE" if campaign.active else ("UPCOMING" if campaign.upcoming else "EXPIRED")
        game_name = campaign.game.name if (campaign.game and hasattr(campaign.game, "name")) else str(campaign.game)
        campaign_img = str(campaign.image_url) if getattr(campaign, "image_url", None) else ""

        ends_str = campaign.ends_at.astimezone().strftime("%Y-%m-%d %H:%M:%S") if getattr(campaign, "ends_at", None) else ""
        starts_str = campaign.starts_at.astimezone().strftime("%Y-%m-%d %H:%M:%S") if getattr(campaign, "starts_at", None) else ""

        acl = getattr(campaign, "allowed_channels", [])
        if acl:
            if len(acl) <= 3:
                channels_str = ", ".join(ch.name for ch in acl)
            else:
                channels_str = f"{', '.join(ch.name for ch in acl[:3])} (+{len(acl) - 3})"
        else:
            channels_str = "All"

        data = {
            "id": campaign.id,
            "game": game_name,
            "name": campaign.name,
            "status": status_str,
            "icon_url": campaign_img,
            "linked": getattr(campaign, "linked", False),
            "eligible": getattr(campaign, "eligible", False),
            "link_url": str(getattr(campaign, "link_url", "")) or "",
            "ends_at": ends_str,
            "starts_at": starts_str,
            "allowed_channels": channels_str,
            "drops": drops_list,
            "finished": getattr(campaign, "finished", False),
            "claimed_drops": getattr(campaign, "claimed_drops", 0),
            "total_drops": getattr(campaign, "total_drops", 0),
        }
        self.campaigns[campaign.id] = data
        self._manager.emit("inventory", {"campaigns": list(self.campaigns.values())})


    def update_drop(self, drop: TimedDrop):
        self._manager.display_drop(drop)
        if hasattr(drop, "campaign") and drop.campaign and drop.campaign.id in self.campaigns:
            campaign_data = self.campaigns[drop.campaign.id]
            for d in campaign_data["drops"]:
                if d.get("id") == drop.id:
                    d["current_minutes"] = getattr(drop, "current_minutes", 0)
                    d["required_minutes"] = getattr(drop, "required_minutes", 0)
                    d["percentage"] = round(drop.progress * 100, 1) if hasattr(drop, "progress") else 0
                    d["is_claimed"] = getattr(drop, "is_claimed", False)
                    break
            self._manager.emit("inventory", {"campaigns": list(self.campaigns.values())})


class OutputProxy:
    def __init__(self, manager: WebGUIManager):
        self._manager = manager

    def print(self, message: str):
        self._manager.print(message)


class AppBridge:
    """Python API exposed to the JavaScript frontend via pywebview."""

    def __init__(self, manager: WebGUIManager):
        self._manager = manager

    def on_ui_ready(self) -> dict:
        twitch = self._manager._twitch
        settings_dict = {
            "autoclaim": getattr(twitch.settings, "autoclaim", True),
            "claim_channel_points": getattr(twitch.settings, "claim_channel_points", True),
            "watchdog_recovery": getattr(twitch.settings, "watchdog_recovery", True),
            "tray": getattr(twitch.settings, "tray", False),
            "discord_webhook": getattr(twitch.settings, "discord_webhook", ""),
            "telegram_token": getattr(twitch.settings, "telegram_token", ""),
            "telegram_chat_id": getattr(twitch.settings, "telegram_chat_id", ""),
            "language": getattr(twitch.settings, "language", "en"),
        }
        priority_games = [g.name if hasattr(g, "name") else str(g) for g in twitch.settings.priority]
        return {
            "settings": settings_dict,
            "priority_games": priority_games,
            "available_games": self._manager._available_games,
            "stats": {
                "claimed": self._manager._stats_claimed,
                "points": self._manager._stats_points,
            }
        }

    def toggle_mining(self):
        self._manager._is_mining_running = not self._manager._is_mining_running
        status_text = "Mining Active" if self._manager._is_mining_running else "Mining Paused"
        self._manager.status.update(status_text)

    def reload_campaigns(self):
        try:
            twitch = self._manager._twitch
            if twitch:
                twitch.change_state(State.INVENTORY_FETCH)
                self._manager.print("Envanter ve kampanyalar yeniden yükleniyor...")
                return {"success": True}
        except Exception as exc:
            logger.error(f"Error reloading campaigns: {exc}")
            return {"success": False, "error": str(exc)}
        return {"success": False, "error": "Twitch not ready"}

    def reload_inventory(self):
        return self.reload_campaigns()

    def save_single_setting(self, key: str, value: Any):
        twitch = self._manager._twitch
        setattr(twitch.settings, key, value)
        twitch.settings.save()
        self._manager.print(f"Ayar güncellendi: {key} = {value}")

    def save_priority_games(self, games_list: list[str]):
        twitch = self._manager._twitch
        twitch.settings.priority = [str(g).strip() for g in games_list if g and str(g).strip()]
        twitch.settings.save()
        self._manager.print(f"Öncelikli oyunlar güncellendi ({len(twitch.settings.priority)} oyun).")

    def test_discord_webhook(self, url: str) -> dict:
        try:
            future = asyncio.run_coroutine_threadsafe(
                self._async_test_discord(url),
                self._manager.loop
            )
            return future.result(timeout=10)
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _async_test_discord(self, url: str) -> dict:
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "username": "Twitch Drops Miner Pro",
                    "embeds": [{
                        "title": "🎉 Discord Webhook Testi Başarılı!",
                        "description": "Twitch Drops Miner Pro (By BCZ) bildirim sistemi aktif ve çalışıyor.",
                        "color": 0x9146FF,
                        "footer": {"text": "Twitch Drops Miner Pro • By BCZ"}
                    }]
                }
                async with session.post(url, json=payload) as resp:
                    if resp.status in (200, 204):
                        return {"success": True}
                    return {"success": False, "error": f"HTTP {resp.status}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def test_telegram_webhook(self, token: str, chat_id: str) -> dict:
        try:
            future = asyncio.run_coroutine_threadsafe(
                self._async_test_telegram(token, chat_id),
                self._manager.loop
            )
            return future.result(timeout=10)
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _async_test_telegram(self, token: str, chat_id: str) -> dict:
        try:
            async with aiohttp.ClientSession() as session:
                url = f"https://api.telegram.org/bot{token}/sendMessage"
                payload = {
                    "chat_id": chat_id,
                    "text": "🎉 *Twitch Drops Miner Pro (By BCZ)*\n\nTelegram bildirim sistemi başarıyla test edildi!",
                    "parse_mode": "Markdown"
                }
                async with session.post(url, json=payload) as resp:
                    if resp.status == 200:
                        return {"success": True}
                    data = await resp.json()
                    return {"success": False, "error": data.get("description", f"HTTP {resp.status}")}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def switch_channel(self, channel_name: str):
        self._manager.channels._selected_channel_name = channel_name
        self._manager.print(f"Yayıncıya manuel geçiş yapılıyor: {channel_name}")
        try:
            from core.constants import State
            self._manager._twitch.change_state(State.CHANNEL_SWITCH)
        except Exception as exc:
            logger.warning(f"switch_channel error: {exc}")

    def open_external_url(self, url: str):
        webbrowser.open(url)

    def logout(self):
        from core.constants import COOKIES_PATH
        if COOKIES_PATH.exists():
            try:
                COOKIES_PATH.unlink()
            except Exception:
                pass
        try:
            self._manager._twitch._auth_state.invalidate(delete_cookies=True)
        except Exception:
            pass
        self._manager.print("Oturum kapatıldı, çerezler silindi.")
        self._manager.status.update("Session Closed — Login Required")
        self._manager.login.set_logged_out()

    def start_twitch_login(self):
        """Trigger device-code OAuth flow from JS login tab."""
        try:
            asyncio.run_coroutine_threadsafe(
                self._async_login_flow(),
                self._manager.loop
            )
        except Exception as exc:
            logger.error(f"start_twitch_login error: {exc}")
            self._manager.emit("login_error", {"error": str(exc)})

    async def _async_login_flow(self):
        try:
            twitch = self._manager._twitch
            auth_state = twitch._auth_state
            auth_state.invalidate(delete_cookies=True)
            self._manager.print("Twitch cihaz kodu isteniyor...")
            token = await auth_state._oauth_login()
            await auth_state.validate()
            self._manager.login.set_logged_in(user_id=auth_state.user_id)
            self._manager.print(f"Twitch girişi başarıyla tamamlandı! (Kullanıcı ID: {auth_state.user_id})")
            await twitch.reload_campaigns()
        except Exception as exc:
            logger.error(f"Login flow error: {exc}", exc_info=True)
            self._manager.emit("login_error", {"error": str(exc)})

    def save_manual_token(self, token: str) -> dict:
        """Allow user to directly paste their auth-token cookie."""
        try:
            clean_token = token.strip()
            if not clean_token:
                return {"success": False, "error": "Token cannot be empty."}
            asyncio.run_coroutine_threadsafe(
                self._async_save_manual_token(clean_token),
                self._manager.loop
            )
            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def _async_save_manual_token(self, token: str):
        try:
            from core.constants import COOKIES_PATH
            twitch = self._manager._twitch
            session = await twitch.get_session()
            jar = session.cookie_jar
            client_info = twitch._client_type
            cookie = jar.filter_cookies(client_info.CLIENT_URL)
            cookie["auth-token"] = token
            jar.update_cookies(cookie, client_info.CLIENT_URL)
            jar.save(COOKIES_PATH)

            auth_state = twitch._auth_state
            auth_state.access_token = token
            await auth_state.validate()
            self._manager.login.set_logged_in(user_id=auth_state.user_id)
            self._manager.print(f"Token başarıyla doğrulandı! (Kullanıcı ID: {auth_state.user_id})")
            await twitch.reload_campaigns()
        except Exception as exc:
            logger.error(f"Manual token error: {exc}")
            self._manager.emit("login_error", {"error": f"Token validation error: {exc}"})

    def confirm_login_code(self):
        self._manager.login.confirm_login()

    def get_auth_status(self) -> dict:
        from core.constants import COOKIES_PATH
        logged_in = False
        user_id = None
        username = ""
        try:
            auth = getattr(self._manager._twitch, "_auth_state", None)
            if auth and hasattr(auth, "user_id"):
                logged_in = True
                user_id = auth.user_id
                username = f"User #{user_id}"
            elif COOKIES_PATH.exists():
                logged_in = True
                username = ""
        except Exception:
            pass
        return {"logged_in": logged_in, "username": username, "user_id": user_id}

    def set_dark_mode(self, is_dark: bool):
        self._manager._twitch.settings.dark_mode = is_dark
        self._manager._twitch.settings.save()


DEFAULT_ACTIVE_GAMES: list[str] = [
    "ACE COMBAT 8: WINGS OF THEVE",
    "ARKNIGHTS: ENDFIELD",
    "Ace Combat Zero: The Belkan War",
    "Active Matter",
    "Airport Baggage Simulator",
    "Albion Online",
    "Aniimo",
    "Apex Legends",
    "Arena Breakout: Infinite",
    "Big Walk",
    "Black Desert",
    "Blue Protocol: Star Resonance",
    "Brawlhalla",
    "CONTROL Resonant",
    "Coin Pusher Live",
    "Coryphaeus Championships",
    "Cyberpunk 2077",
    "Dead by Daylight",
    "Delta Force",
    "Destiny 2",
    "Diablo IV",
    "DRAGON BALL GEKISHIN SQUADRA",
    "Dungeons & Dragons",
    "EA Sports FC 25",
    "EA Sports FC 27",
    "Escape from Tarkov",
    "Escape from Tarkov: Arena",
    "Eternal Return",
    "EVE Online",
    "For Honor",
    "Fortnite",
    "Genshin Impact",
    "Grand Theft Auto V",
    "Hearthstone",
    "Heroes of the Storm",
    "HITMAN World of Assassination",
    "Honkai: Star Rail",
    "Hunt: Showdown 1896",
    "Infinity Nikki",
    "Kakele Online - MMORPG",
    "Kirka.io",
    "League of Legends",
    "Legend of YMIR",
    "Lost Ark",
    "MARVEL Contest of Champions",
    "MARVEL SNAP",
    "MARVEL Strike Force",
    "Marvel Rivals",
    "Metaphor: ReFantazio",
    "Mir Korabley",
    "Mobile Dungeon",
    "Modern Warships",
    "NARAKA: BLADEPOINT",
    "New World: Aeternum",
    "Night Crows",
    "Out of the Park Baseball 27",
    "Overwatch 2",
    "Paladins",
    "Path of Exile",
    "Path of Exile 2",
    "PAYDAY 3",
    "PERSONA3 RELOAD",
    "Persona 4 Golden",
    "Persona 5 Royal",
    "Plants on Fire",
    "Predecessor",
    "PUBG: BATTLEGROUNDS",
    "Rainbow Six Siege",
    "RavenQuest",
    "Ravendawn",
    "Relic Arena",
    "REMATCH",
    "Rise Online",
    "Rocket League",
    "RuneScape: Dragonwilds",
    "Rust",
    "Sea of Thieves",
    "Shakes and Fidget",
    "Shin Megami Tensei V: Vengeance",
    "Sid Meier's Civilization VII",
    "Skull and Bones",
    "Smite 2",
    "Sonic Rumble Party",
    "Special Events",
    "Splinterlands",
    "Storm Striker",
    "The Blood of Dawnwalker",
    "The Elder Scrolls Online",
    "The First Descendant",
    "The Quinfall",
    "The Witcher 3: Wild Hunt",
    "Throne and Liberty",
    "Tom Clancy's Rainbow Six Siege",
    "Tom Clancy's The Division 2",
    "UFL",
    "VALORANT",
    "War Robots: Frontiers",
    "WARDOGS",
    "Warframe",
    "Warhammer 40,000: Darktide",
    "Where Winds Meet",
    "Wolvesville",
    "World of Tanks",
    "World of Tanks: HEAT",
    "World of Warships",
    "Zenless Zone Zero",
]


class WebGUIManager:
    """Complete drop-in GUI replacement for TwitchDropsMiner powered by PyWebView."""

    def __init__(self, twitch: Twitch):
        self._twitch = twitch
        self.loop = asyncio.get_event_loop()
        self._window: webview.Window | None = None
        self._close_event = asyncio.Event()
        self._is_mining_running = True

        self._stats_claimed = 0
        self._stats_points = 0
        self._available_games: list[str] = sorted(list(set(DEFAULT_ACTIVE_GAMES)))

        # Subcomponents
        self.status = StatusProxy(self)
        self.websockets = WebsocketProxy(self)
        self.login = LoginProxy(self)
        self.progress = ProgressProxy(self)
        self.output = OutputProxy(self)
        self.channels = ChannelsProxy(self)
        self.inv = InventoryProxy(self)
        self.tray = DummyTray(self)
        self.help = DummyHelp()

        self._is_closing = False
        self.bridge = AppBridge(self)

    def set_window(self, window: webview.Window):
        self._window = window

    def emit(self, event_type: str, data: dict):
        if self._window is not None:
            try:
                payload = json.dumps(data)
                script = f"window.app && window.app.onEvent('{event_type}', {payload});"
                self._window.evaluate_js(script)
            except Exception:
                pass

    def print(self, message: str):
        msg = str(message).strip()
        if not msg:
            return
        log_type = "mining"
        if "Drop" in msg or "claim" in msg.lower() or "toplandı" in msg.lower():
            log_type = "claim"
            if "toplandı" in msg.lower() or "claim" in msg.lower():
                self._stats_claimed += 1
                self.emit("claim", {"name": msg})
        elif "Bonus" in msg or "Puan" in msg or "points" in msg.lower():
            log_type = "points"
            self._stats_points += 50
            self.emit("point_bonus", {"amount": 50})
        elif "Hata" in msg or "Error" in msg or "Fail" in msg:
            log_type = "error"

        self.emit("log", {"message": msg, "type": log_type})

    def display_drop(self, drop: TimedDrop | None, *, countdown: bool = True, subone: bool = False):
        self.progress.display(drop, countdown=countdown, subone=subone)

    def clear_drop(self):
        self.emit("drop_progress", {
            "drop_name": "",
            "campaign_title": "",
            "image_url": "",
            "current_minutes": 0,
            "required_minutes": 0,
            "percentage": 0,
            "eta": "--",
            "channel_name": ""
        })

    def set_games(self, games_set: set[Any]):
        names = set(DEFAULT_ACTIVE_GAMES)
        for g in games_set:
            if hasattr(g, "name"):
                names.add(g.name)
            elif g:
                names.add(str(g))
        self._available_games = sorted(list(names))
        self.emit("available_games", {"games": self._available_games})
        self.print(f"Aktif Kampanya Oyunları Yüklendi ({len(self._available_games)} oyun).")

    def grab_attention(self, sound: bool = True):
        pass

    def start(self):
        pass

    def stop(self):
        pass

    def close_window(self):
        self.close()

    def save(self, force: bool = False):
        self._twitch.settings.save(force=force)

    def prevent_close(self):
        pass

    @property
    def close_requested(self) -> bool:
        return self._close_event.is_set()

    async def wait_until_closed(self):
        await self._close_event.wait()

    async def coro_unless_closed(self, coro):
        task = asyncio.create_task(coro)
        close_waiter = asyncio.create_task(self._close_event.wait())
        done, pending = await asyncio.wait(
            [task, close_waiter], return_when=asyncio.FIRST_COMPLETED
        )
        for p in pending:
            p.cancel()
        if task in done:
            return task.result()
        return None

    def close(self, from_window: bool = False):
        if getattr(self, "_is_closing", False):
            return
        self._is_closing = True
        try:
            self.loop.call_soon_threadsafe(self._close_event.set)
        except Exception:
            self._close_event.set()
        # Never call destroy() when close event originated from the window closing itself
        if not from_window and self._window:
            try:
                self._window.destroy()
            except Exception:
                pass

