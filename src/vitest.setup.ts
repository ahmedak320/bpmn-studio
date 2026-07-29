import { configure } from '@testing-library/dom'

// Give-up deadline for findBy*/waitFor. Not a wait: polling resolves the
// moment the awaited DOM state appears. Calibrated from measurement: the
// section 7.3 click->dialog/click->toast waits reach 3.0 s at loadavg ~38;
// 10 s is >3x the worst observed.
configure({ asyncUtilTimeout: 10_000 })
