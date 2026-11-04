from fulfillment.picking import pick


def test_pick_weighs_the_parcel():
    assert pick([{"sku": "mug", "quantity": 2}])["grams"] == 700
