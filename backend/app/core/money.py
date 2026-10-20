"""Money is stored as integer minor units (tiyn) and exposed to the API in major units (tenge)."""


def to_major(minor: int) -> int | float:
    return minor // 100 if minor % 100 == 0 else round(minor / 100, 2)


def to_minor(major: float) -> int:
    return int(round(major * 100))
