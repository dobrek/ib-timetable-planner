import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { actions, isInputError } from "astro:actions";
import { navigate } from "astro:transitions/client";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Badge } from "@/shared/ui";
import { Button } from "@/shared/ui";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/shared/ui";
import { Input } from "@/shared/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import {
  deriveMergeParent,
  formatCourseLabel,
  mergeInput,
  mergeReasonMessage,
  type MergeInput,
} from "@/entities/course";
import type { CourseRow } from "@/entities/course";
import type { TeacherOption } from "@/entities/teacher";
import { cn } from "@/shared/lib/cn";

type MergeBuilderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: CourseRow[];
  teachers: TeacherOption[];
  /** The active cohort the merge is scoped to. */
  cohortId: string;
};

/** Empty number field → undefined so the resolver reports "required" rather than NaN. */
const toNumberOrUndefined = (raw: string): number | undefined => (raw === "" ? undefined : Number(raw));

/**
 * Author a new composite merge for the active cohort. Reuses the popover+command
 * multi-select shape from `TeacherFilter` to pick atomic children and the RHF +
 * `zodResolver(mergeInput)` + `navigate()` flow from `CourseFormDialog`. The parent
 * name/level/teacher are derived live and read-only via `deriveMergeParent` — the same
 * pure module the server re-checks — so the preview can never drift from what's stored.
 * Tokens only (lessons rule #2).
 */
export default function MergeBuilderDialog({
  open,
  onOpenChange,
  courses,
  teachers,
  cohortId,
}: MergeBuilderDialogProps) {
  const form = useForm<MergeInput>({
    resolver: zodResolver(mergeInput),
    mode: "onTouched",
    defaultValues: { childCourseIds: [], hoursPerWeek: undefined, cohortId },
  });

  // Re-seed whenever the dialog opens or the active cohort changes.
  useEffect(() => {
    if (!open) return;
    form.reset({ childCourseIds: [], hoursPerWeek: undefined, cohortId });
  }, [open, cohortId, form]);

  // Candidate children: atomic courses in the active cohort (a composite parent can't be a child).
  const candidates = useMemo(
    () => courses.filter((course) => course.cohortId === cohortId && !course.isMerged),
    [courses, cohortId],
  );
  const coursesById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const teacherLabelById = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher.label])), [teachers]);

  const selectedIds = useWatch({ control: form.control, name: "childCourseIds" });
  const selectedChildren = selectedIds
    .map((id) => coursesById.get(id))
    .filter((course): course is CourseRow => Boolean(course));
  const derivation = deriveMergeParent(
    selectedChildren.map((course) => ({
      id: course.id,
      name: course.name,
      level: course.level,
      cohortId: course.cohortId,
      teacherId: course.teacherId,
    })),
  );

  const onSubmit = async (values: MergeInput) => {
    const { error } = await actions.createMerge(values);
    if (error) {
      if (isInputError(error)) {
        for (const [field, messages] of Object.entries(error.fields)) {
          if (messages.length > 0) {
            form.setError(field as keyof MergeInput, { message: messages[0] });
          }
        }
      } else if (error.code === "CONFLICT" || error.code === "BAD_REQUEST") {
        form.setError("childCourseIds", { message: error.message });
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success("Merge created");
    onOpenChange(false);
    await navigate(window.location.pathname + window.location.search);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New merge</DialogTitle>
          <DialogDescription>
            Combine 2+ courses that share a name and teacher into a composite session.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
            <FormField
              control={form.control}
              name="childCourseIds"
              render={({ field }) => {
                const selected = new Set(field.value);
                const toggle = (id: string) => {
                  const next = new Set(selected);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  field.onChange([...next]);
                };
                const selectedList = candidates.filter((course) => selected.has(course.id));
                return (
                  <FormItem className="flex flex-col">
                    <FormLabel>Courses to merge</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="justify-between font-normal"
                          onBlur={field.onBlur}
                        >
                          {selected.size > 0 ? `${selected.size} selected` : "Select courses…"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search courses…" autoComplete="off" />
                          <CommandList>
                            <CommandEmpty>No courses found.</CommandEmpty>
                            <CommandGroup>
                              {candidates.map((course) => {
                                const isSelected = selected.has(course.id);
                                return (
                                  <CommandItem
                                    key={course.id}
                                    value={formatCourseLabel(course)}
                                    onSelect={() => {
                                      toggle(course.id);
                                    }}
                                  >
                                    <Check
                                      className={cn("mr-2", isSelected ? "opacity-100" : "opacity-0")}
                                      aria-hidden="true"
                                    />
                                    {formatCourseLabel(course)}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {selectedList.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedList.map((course) => (
                          <Badge key={course.id} variant="secondary" className="gap-1">
                            {formatCourseLabel(course)}
                            <button
                              type="button"
                              aria-label={`Remove ${course.name}`}
                              className="hover:text-foreground -mr-0.5 rounded-sm"
                              onClick={() => {
                                toggle(course.id);
                              }}
                            >
                              <X className="size-3" aria-hidden="true" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <div className="border-border bg-muted/40 rounded-md border p-3 text-sm">
              {selectedChildren.length < 2 ? (
                <p className="text-muted-foreground">Select at least 2 courses to preview the composite.</p>
              ) : derivation.ok ? (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Composite preview</p>
                  <p className="text-foreground font-medium">
                    {derivation.parent.name} <span className="text-muted-foreground">({derivation.parent.level})</span>
                  </p>
                  <p className="text-muted-foreground">
                    Teacher: {teacherLabelById.get(derivation.parent.teacherId) ?? "—"}
                  </p>
                </div>
              ) : (
                <p className="text-destructive">{mergeReasonMessage(derivation.reason)}</p>
              )}
            </div>

            <FormField
              control={form.control}
              name="hoursPerWeek"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Weekly hours</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      autoComplete="off"
                      // Keep the input controlled with "" before entry (a plain ?? is type-pruned).
                      value={Number.isFinite(field.value) ? field.value : ""}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      onChange={(event) => {
                        field.onChange(toNumberOrUndefined(event.target.value));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!derivation.ok || form.formState.isSubmitting}>
                Create merge
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
