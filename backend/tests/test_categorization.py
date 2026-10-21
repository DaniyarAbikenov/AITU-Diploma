from app.engine.categorization import categorize


def test_keyword_rules():
    assert categorize("Magnum Cash&Carry").category_id == "food"
    assert categorize("Kaspi Рассрочка — iPhone").category_id == "credit"
    assert categorize("Алсеко ЖКУ").category_id == "housing"
    assert categorize("ТОО «Технодом» — зарплата").category_id == "income"


def test_unknown_merchant_goes_to_review():
    c = categorize("ИП Нурлан К.")
    assert (c.category_id, c.needs_review) == ("other", True)


def test_user_rule_beats_keywords():
    c = categorize("Glovo", {"Glovo": "food"})
    assert (c.category_id, c.source, c.needs_review) == ("food", "user", False)
