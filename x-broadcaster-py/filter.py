"""
User filtering — filter search results by criteria before sending DMs.
"""


def filter_users(users: list, rules: dict) -> list:
    """
    Filter users by criteria.
    Returns users that pass all filters.

    Rules:
        min_followers: int = 0        # Minimum follower count
        max_followers: int = None     # Maximum follower count
        max_follow_ratio: float = None # Max following/followers ratio
        require_avatar: bool = False   # Must have profile picture
        require_bio: bool = False      # Must have bio
        min_tweets: int = 0           # Minimum tweet count
        require_verified: bool = False # Must be verified
        exclude_protected: bool = True # Exclude private accounts
        topic_keywords: list = []     # Bio must contain one of these
    """
    passed = []
    for user in users:
        if _check_user(user, rules):
            passed.append(user)
    return passed


def _check_user(user: dict, rules: dict) -> bool:
    if rules.get("exclude_protected", True) and user.get("protected"):
        return False

    if rules.get("require_avatar") and not user.get("avatar"):
        return False

    if rules.get("require_bio") and not user.get("bio"):
        return False

    if rules.get("require_verified") and not user.get("verified"):
        return False

    min_followers = rules.get("min_followers", 0)
    if user.get("followers", 0) < min_followers:
        return False

    max_followers = rules.get("max_followers")
    if max_followers is not None and user.get("followers", 0) > max_followers:
        return False

    min_tweets = rules.get("min_tweets", 0)
    if user.get("tweets", 0) < min_tweets:
        return False

    max_ratio = rules.get("max_follow_ratio")
    if max_ratio is not None and user.get("followers", 0) > 0:
        ratio = user.get("following", 0) / user.get("followers", 1)
        if ratio > max_ratio:
            return False

    topics = rules.get("topic_keywords", [])
    if topics:
        bio = (user.get("bio") or "").lower()
        if not any(t.lower() in bio for t in topics):
            return False

    return True
