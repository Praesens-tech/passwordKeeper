import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { PasswordForm } from "../PasswordForm";
import { GroupForm } from "../GroupForm";

const image = "data:image/jpeg;base64,dGVzdA==";

vi.mock("../../store/vaultStore", () => ({
  useVaultStore: () => ({
    vault: { groups: [{ id: "group", name: "Work", icon: image }] },
    sharedSources: [],
    addEntry: vi.fn(), updateEntry: vi.fn(), addGroup: vi.fn(), updateGroup: vi.fn(),
  }),
}));

vi.mock("../IconPicker", () => ({
  IconPicker: ({ onChange }: { onChange: (icon: string) => void }) => (
    <button type="button" onClick={() => onChange(image)}>Choose image</button>
  ),
}));

describe("Image icons in forms", () => {
  it("shows the group name rather than its image data when selected", () => {
    render(<PasswordForm defaultGroupId="group" onClose={vi.fn()} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("group");
    expect(select.selectedOptions[0].textContent?.trim()).toBe("Work");
    expect(select.textContent).not.toContain("data:image/");
  });

  it.each([PasswordForm, GroupForm])("renders a selected image without displaying its encoded contents", (Form) => {
    const { container } = render(<Form onClose={vi.fn()} />);
    fireEvent.click(container.querySelector("button")!);
    fireEvent.click(screen.getByText("Choose image"));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(image);
    expect(container.textContent).not.toContain("data:image/");
    expect(screen.queryByText("Choose image")).not.toBeInTheDocument();
  });
});
