'use strict';

// Fixtures in unrelated feature tests intentionally include historical values.
// Complete the real startup review UI before testing those features.
module.exports=async function retainHistoricalFixtureValues(page){
 await page.evaluate(()=>studentIntegrityCheckAfterUpdate());
 await page.waitForFunction(()=>localStorage.getItem(STUDENT_INTEGRITY_REVIEW_KEY)===SYS_VER||document.getElementById('studentIntegrityUpdateLayer'));
 if(await page.locator('#studentIntegrityUpdateLayer').count()){
  await page.locator('#studentIntegrityKeep').click();
  await page.locator('#studentIntegrityUpdateLayer').waitFor({state:'detached'});
 }
 await page.evaluate(()=>fixedValueReviewCheckAfterUpdate());
 await page.waitForFunction(()=>localStorage.getItem(FIXED_VALUE_REVIEW_KEY)===FIXED_VALUE_REVIEW_SIGNATURE||document.getElementById('fixedValueReviewLayer'));
 if(await page.locator('#fixedValueReviewLayer').count()){
  await page.locator('#fixedValueReviewKeep').click();
  await page.locator('#fixedValueReviewLayer').waitFor({state:'detached'});
 }
 await page.evaluate(()=>workbench.legacy.flushStore());
};
