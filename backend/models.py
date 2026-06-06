from pydantic import BaseModel
from typing import Any, Literal


class TopicCreate(BaseModel):
    name: str


class SubscribeRequest(BaseModel):
    topic_name: str
    subscriber_name: str
    url: str


class PublishRequest(BaseModel):
    topic_name: str
    payload: dict[str, Any]
    priority: Literal["high", "normal", "low"] = "normal"