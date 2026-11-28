"""Knowledge base of smart insights (knowledge_base.json, specification v1.0.0 + addendum): loading and validation.

The base is data: conditions over computed signals, message templates and delivery policies. Formulas in it are
mathematical pseudocode and are never executed; every signal R001–R190 has its own Python evaluator (signals.py)."""
import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).parent
KB_FILE = HERE / "knowledge_base.json"
ADDENDUM_FILE = HERE / "addendum.json"
REQUIRED = ("id", "version", "title", "module", "entry_type", "activation", "message", "action", "missing_data",
            "delivery", "rollout")


class KnowledgeBaseError(ValueError):
    pass


@dataclass
class KnowledgeBase:
    version: str
    title: str
    activation_contract: dict
    pilot_config: dict
    global_policies: list
    ranking: list
    entries: list[dict]
    signal_formulas: dict[str, str] = field(default_factory=dict)  # R-id -> formula (pseudocode, for "why")
    addendum_version: str | None = None

    def entry(self, entry_id: str) -> dict | None:
        return next((e for e in self.entries if e["id"] == entry_id), None)

    def config(self, key: str):
        v = self.pilot_config.get(key)
        return v["value"] if isinstance(v, dict) and "value" in v else v


def referenced_signals(entry: dict) -> set[str]:
    return {c["fact"].split(".")[1] for c in entry["activation"]["all"] if c["fact"].startswith("signals.")}


def validate(raw: dict) -> list[str]:
    """Problems that make the base unusable: duplicate ids, missing fields, unknown operators or signals."""
    problems: list[str] = []
    ops = set(raw.get("activation_contract", {}).get("operators", []))
    ids = [e.get("id") for e in raw.get("entries", [])]
    if len(ids) != len(set(ids)):
        problems.append("повторяющиеся id записей")
    if raw.get("entry_count") is not None and raw["entry_count"] != len(ids):
        problems.append(f"entry_count={raw['entry_count']}, а записей {len(ids)}")
    defined = {e["calculation_reference"]["id"] for e in raw.get("entries", []) if e.get("calculation_reference")}
    for e in raw.get("entries", []):
        missing = [f for f in REQUIRED if f not in e]
        if missing:
            problems.append(f"{e.get('id')}: нет полей {missing}")
            continue
        conds = e["activation"].get("all") or []
        if not conds:
            problems.append(f"{e['id']}: пустое условие активации")
        for c in conds:
            if c.get("op") not in ops:
                problems.append(f"{e['id']}: неизвестный оператор {c.get('op')}")
            if c["op"] == "gte_config" and c.get("config_key") not in raw.get("pilot_config", {}):
                problems.append(f"{e['id']}: нет настройки {c.get('config_key')}")
        for sig in referenced_signals(e):
            if sig not in defined:
                problems.append(f"{e['id']}: сигнал {sig} нигде не определён")
        if e["action"].get("automatic_execution") is not False:
            problems.append(f"{e['id']}: действие не должно выполняться автоматически")
    return problems


def _merge_addendum(raw: dict) -> str | None:
    if not ADDENDUM_FILE.exists():
        return None
    add = json.loads(ADDENDUM_FILE.read_text(encoding="utf-8"))
    raw["entries"] = raw["entries"] + add.get("entries", [])
    raw["entry_count"] = len(raw["entries"])
    for k, v in add.get("pilot_config", {}).items():
        raw["pilot_config"].setdefault(k, v)
    raw["global_policies"] = raw["global_policies"] + add.get("global_policies", [])
    return add.get("version")


@lru_cache(maxsize=1)
def load() -> KnowledgeBase:
    raw = json.loads(KB_FILE.read_text(encoding="utf-8"))
    if raw.get("contains_personal_records") is not False:
        raise KnowledgeBaseError("база знаний не должна содержать личных записей")
    addendum = _merge_addendum(raw)
    problems = validate(raw)
    if problems:
        raise KnowledgeBaseError("; ".join(problems[:10]))
    formulas = {e["calculation_reference"]["id"]: e["calculation_reference"]["formula"]
                for e in raw["entries"] if e.get("calculation_reference")}
    return KnowledgeBase(version=raw["version"], title=raw["title"], activation_contract=raw["activation_contract"],
                         pilot_config=raw["pilot_config"], global_policies=raw["global_policies"],
                         ranking=raw["ranking_and_delivery_policies"], entries=raw["entries"],
                         signal_formulas=formulas, addendum_version=addendum)
