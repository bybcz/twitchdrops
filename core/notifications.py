from __future__ import annotations

import logging
import asyncio
from datetime import datetime, timezone
from typing import Any, TYPE_CHECKING

import aiohttp

if TYPE_CHECKING:
    from settings import Settings

logger = logging.getLogger("TwitchDrops.notifications")


class NotificationService:
    def __init__(self, settings: Settings, session: aiohttp.ClientSession | None = None) -> None:
        self.settings = settings
        self._session = session

    def set_session(self, session: aiohttp.ClientSession) -> None:
        self._session = session

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is not None and not self._session.closed:
            return self._session
        return aiohttp.ClientSession()

    async def notify_drop_claimed(
        self,
        game_name: str,
        drop_name: str,
        campaign_name: str,
        progress_text: str,
        image_url: str | None = None,
    ) -> None:
        """Send notifications across all enabled providers when a drop is claimed."""
        if not getattr(self.settings, "notify_on_drop_claim", True):
            return

        title = f"🎁 Drop Claimed: {game_name}"
        description = (
            f"**Drop:** {drop_name}\n"
            f"**Campaign:** {campaign_name}\n"
            f"**Progress:** {progress_text}"
        )

        tasks = []
        discord_url = getattr(self.settings, "discord_webhook", "").strip()
        if discord_url:
            tasks.append(
                self.send_discord(
                    webhook_url=discord_url,
                    title=title,
                    description=description,
                    color=0x9146FF,  # Twitch Purple
                    fields=[
                        {"name": "Game", "value": game_name, "inline": True},
                        {"name": "Progress", "value": progress_text, "inline": True},
                    ],
                    thumbnail_url=image_url,
                )
            )

        tg_token = getattr(self.settings, "telegram_bot_token", "").strip()
        tg_chat_id = getattr(self.settings, "telegram_chat_id", "").strip()
        if tg_token and tg_chat_id:
            tg_text = (
                f"<b>🎁 Drop Claimed!</b>\n\n"
                f"<b>Game:</b> {game_name}\n"
                f"<b>Reward:</b> {drop_name}\n"
                f"<b>Campaign:</b> {campaign_name}\n"
                f"<b>Status:</b> {progress_text}"
            )
            tasks.append(self.send_telegram(tg_token, tg_chat_id, tg_text))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def notify_channel_points(self, channel_name: str, points: int) -> None:
        """Send notifications when channel points are claimed (if enabled)."""
        if not getattr(self.settings, "notify_on_channel_points", False):
            return

        title = f"🪙 Channel Points Claimed: +{points}"
        description = f"Successfully claimed **+{points} points** on **{channel_name}**!"

        discord_url = getattr(self.settings, "discord_webhook", "").strip()
        if discord_url:
            await self.send_discord(
                webhook_url=discord_url,
                title=title,
                description=description,
                color=0x00E676,
            )

    async def notify_campaign_completed(self, game_name: str, campaign_name: str) -> None:
        """Send notifications when all drops for a campaign have been collected."""
        if not getattr(self.settings, "notify_on_campaign_completed", True):
            return

        title = f"🏆 Campaign Completed: {game_name}"
        description = f"All drops for **{campaign_name}** ({game_name}) have been mined and claimed!"

        tasks = []
        discord_url = getattr(self.settings, "discord_webhook", "").strip()
        if discord_url:
            tasks.append(
                self.send_discord(
                    webhook_url=discord_url,
                    title=title,
                    description=description,
                    color=0xFFD700,  # Gold
                )
            )

        tg_token = getattr(self.settings, "telegram_bot_token", "").strip()
        tg_chat_id = getattr(self.settings, "telegram_chat_id", "").strip()
        if tg_token and tg_chat_id:
            tg_text = (
                f"<b>🏆 Campaign Completed!</b>\n\n"
                f"<b>Game:</b> {game_name}\n"
                f"<b>Campaign:</b> {campaign_name}\n"
                f"All drops have been successfully mined!"
            )
            tasks.append(self.send_telegram(tg_token, tg_chat_id, tg_text))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_discord(
        self,
        webhook_url: str,
        title: str,
        description: str,
        color: int = 0x9146FF,
        fields: list[dict[str, Any]] | None = None,
        thumbnail_url: str | None = None,
    ) -> bool:
        if not webhook_url or not webhook_url.startswith("http"):
            return False

        embed: dict[str, Any] = {
            "title": title,
            "description": description,
            "color": color,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "footer": {"text": "Twitch Drops Miner Next"},
        }
        if fields:
            embed["fields"] = fields
        if thumbnail_url and thumbnail_url.startswith("http"):
            embed["thumbnail"] = {"url": thumbnail_url}

        payload = {
            "username": "Twitch Drops Miner",
            "avatar_url": "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c854c30c804f4ecdb262f3ec02ba4271/default/dark/3.0",
            "embeds": [embed],
        }

        try:
            close_session = False
            session = self._session
            if session is None or session.closed:
                session = aiohttp.ClientSession()
                close_session = True

            try:
                proxy = getattr(self.settings, "proxy", None)
                kwargs: dict[str, Any] = {"json": payload, "timeout": 15}
                if proxy and str(proxy):
                    kwargs["proxy"] = proxy

                async with session.post(webhook_url, **kwargs) as resp:
                    if resp.status in (200, 204):
                        logger.info("Discord notification sent successfully.")
                        return True
                    else:
                        logger.warning(f"Discord webhook failed with HTTP {resp.status}")
                        return False
            finally:
                if close_session and not session.closed:
                    await session.close()
        except Exception as exc:
            logger.warning(f"Failed to send Discord notification: {exc}")
            return False

    async def send_telegram(
        self,
        bot_token: str,
        chat_id: str,
        message: str,
    ) -> bool:
        if not bot_token or not chat_id:
            return False

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }

        try:
            close_session = False
            session = self._session
            if session is None or session.closed:
                session = aiohttp.ClientSession()
                close_session = True

            try:
                proxy = getattr(self.settings, "proxy", None)
                kwargs: dict[str, Any] = {"json": payload, "timeout": 15}
                if proxy and str(proxy):
                    kwargs["proxy"] = proxy

                async with session.post(url, **kwargs) as resp:
                    if resp.status == 200:
                        logger.info("Telegram notification sent successfully.")
                        return True
                    else:
                        logger.warning(f"Telegram notification failed with HTTP {resp.status}")
                        return False
            finally:
                if close_session and not session.closed:
                    await session.close()
        except Exception as exc:
            logger.warning(f"Failed to send Telegram notification: {exc}")
            return False
