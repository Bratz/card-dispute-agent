"""TS-16 as automation: the persona walkthroughs, driven by Playwright.
Needs a running server (python app.py) and resets the demo database.
Run: python test_ui.py [base_url]     (default http://127.0.0.1:8137)
"""
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137"

from playwright.sync_api import sync_playwright, expect


def api(path, method="POST", user="lead"):
    req = urllib.request.Request(BASE + path, method=method, headers={"X-User": user})
    with urllib.request.urlopen(req) as r:
        return r.read()


def become(page, user):
    page.goto(BASE + "/")
    page.evaluate("localStorage.setItem('dc-user', '%s')" % user)
    page.reload()
    page.wait_for_timeout(600)


def nav_texts(page):
    return page.locator(".side nav a").all_inner_texts()


def expect_toast(page, text):
    """Wait for a toast CONTAINING text — earlier toasts may still be on screen."""
    page.wait_for_selector('.toast:has-text("%s")' % text, timeout=6000)


def main():
    api("/api/reset")
    results = []
    ok = lambda name: (results.append("PASS  " + name), print("PASS ", name))

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)   # system Chrome; no browser download
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # T1 — analyst: trimmed nav, lands on the queue, no Reset button
        become(page, "user1")
        nav = " ".join(nav_texts(page))
        assert "Case Queue" in nav and "Approvals" in nav and "Cardholder view" in nav, nav
        assert "Administration" not in nav and "Dashboard" not in nav, nav
        expect(page.locator("h1")).to_contain_text("Case Queue")
        assert page.get_by_text("Reset demo").count() == 0
        ok("T1 analyst nav & landing")

        # T2 — analyst takes the most urgent case
        page.get_by_role("button", name="Take next case").click()
        expect_toast(page, "You took DSP-")
        expect(page.locator("h1")).to_contain_text("DSP-100205")   # expired window = most urgent
        ok("T2 take-next claims the urgent case")

        # T3 — the inject: Demo scenarios -> late evidence -> visible change
        page.get_by_text("Demo scenarios").click()
        page.get_by_role("button", name="Late merchant evidence").click()
        page.wait_for_timeout(1500)
        expect(page.get_by_text("The evidence is in conflict.")).to_be_visible()
        expect(page.get_by_text("What changed", exact=False).first).to_be_visible()
        expect(page.get_by_text("The assessment moved", exact=False).first).to_be_visible()
        ok("T3 inject: conflict banner + what changed")

        # T4 — approve (analyst may approve an evidence ask), timeout, retry reconciles
        page.get_by_role("button", name="Approve", exact=True).click()
        expect_toast(page, "Approved by R. Mehta")
        page.wait_for_timeout(800)
        page.locator(".rec select").select_option("timeout")
        page.get_by_role("button", name="Execute").click()
        expect_toast(page, "Executing")
        page.wait_for_timeout(800)
        page.locator(".rec select").select_option("ok")
        page.get_by_role("button", name="Retry").click()
        expect_toast(page, "Reconciled")
        ok("T4 approve -> timeout -> retry reconciles, no second effect")

        # T5 — money needs the lead: analyst refused in the approvals queue
        page.locator(".side nav a", has_text="Approvals").click()
        page.wait_for_timeout(600)
        assert page.get_by_text("scored").first.is_visible()        # basis chips
        row = page.locator("tr", has_text="Raise chargeback")
        row.get_by_role("button", name="Approve").click()
        expect_toast(page, "team lead")
        ok("T5 approvals show basis; money approval refused for analyst")

        # T6 — four-eyes on the decision: reviewer cannot decide; second person can
        become(page, "user2")
        page.locator("tr", has_text="DSP-100205").first.click()
        page.wait_for_timeout(700)
        page.locator(".tabs a", has_text="Decision").click()
        page.get_by_role("button", name="Mark interpretation reviewed").click()
        expect_toast(page, "reviewed")
        page.wait_for_timeout(800)
        page.get_by_text("Merchant favour", exact=False).first.click()
        page.get_by_role("button", name="Record decision").click()
        expect_toast(page, "four-eyes")
        become(page, "user1")
        page.locator("tr", has_text="DSP-100205").first.click()
        page.wait_for_timeout(700)
        page.locator(".tabs a", has_text="Decision").click()
        page.get_by_text("Merchant favour", exact=False).first.click()
        page.get_by_role("button", name="Record decision").click()
        expect_toast(page, "Liability recorded by R. Mehta")
        ok("T6 four-eyes: reviewer blocked, second person records")

        # T7 — ops manager: dashboard only, read-only book
        become(page, "ops")
        expect(page.locator("h1")).to_contain_text("Operations Dashboard")
        nav = " ".join(nav_texts(page))
        assert "Case Queue" not in nav and "Approvals" not in nav, nav
        ok("T7 ops lands on the dashboard, no case screens")

        # T8 — auditor: read-only case view, full history
        become(page, "auditor")
        expect(page.locator("h1")).to_contain_text("Reports")
        page.locator(".side nav a", has_text="Case Queue").click()
        page.wait_for_timeout(600)
        page.locator("tr", has_text="DSP-100198").first.click()
        page.wait_for_timeout(700)
        assert page.get_by_role("button", name="Approve", exact=True).count() == 0
        assert page.get_by_role("button", name="Add evidence").count() == 0
        page.locator(".tabs a", has_text="History").click()
        expect(page.get_by_text("Full audit trail")).to_be_visible()
        ok("T8 auditor is read-only with full history")

        # T9 — cardholder view: manual fallback raises a dispute (LLM off)
        become(page, "user1")
        page.locator(".side nav a", has_text="Cardholder view").click()
        page.wait_for_timeout(600)
        page.get_by_role("button", name="Enter details myself").click()
        page.get_by_placeholder("Amount").fill("64")
        page.get_by_placeholder("Transaction id (from your statement)").fill("TXN-UI-1")
        page.get_by_role("button", name="Submit dispute").click()
        expect_toast(page, "raised")
        ok("T9 cardholder raises a dispute through the channel form")

        browser.close()

    print("\nUI PASS — %d/9 scenarios" % len(results))


if __name__ == "__main__":
    main()
